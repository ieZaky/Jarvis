import datetime as dt
import http.client
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error

from jarvis import Jarvis, Handler, Server, calculate, valid_url

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = Jarvis(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_memory_and_tasks_persist(self):
        self.app.tool({"operation":"remember","text":"I prefer Arabic"})
        due = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10)).isoformat()
        task = self.app.tool({"operation":"add_task","text":"Review QA cases","due":due})
        app = Jarvis(self.temp.name)
        self.assertEqual(app.tool({"operation":"recall","text":"arabic"})[0]["content"],"I prefer Arabic")
        self.assertAlmostEqual(app.tool({"operation":"list_tasks"})[0]["due"],dt.datetime.fromisoformat(due).timestamp())
        app.tool({"operation":"complete_task","id":task["task_id"]})
        self.assertEqual(app.tool({"operation":"list_tasks"}), [])

    def test_missing_task_is_not_reported_complete(self):
        with self.assertRaises(ValueError):
            self.app.tool({"operation":"complete_task","id":200})

    def test_due_requires_timezone(self):
        with self.assertRaises(ValueError):
            self.app.tool({"operation":"add_task","text":"test","due":"2030-01-01T12:00:00"})

    def test_files_stay_inside_workspace_and_never_overwrite(self):
        self.app.tool({"operation":"write_file","path":"notes/today.txt","text":"hello"})
        self.assertEqual(self.app.tool({"operation":"read_file","path":"notes/today.txt"})["content"],"hello")
        with self.assertRaises(FileExistsError):
            self.app.tool({"operation":"write_file","path":"notes/today.txt","text":"replace"})
        for path in ("../settings.json","/etc/passwd",r"C:\Windows\win.ini","a/../../x"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.app.file_path(path)

    def test_symlink_escape_rejected(self):
        link = self.app.workspace / "escape"
        try:
            link.symlink_to(self.app.home, target_is_directory=True)
        except OSError:
            self.skipTest("Symlink permission unavailable")
        with self.assertRaises(ValueError):
            self.app.file_path("escape/settings.json")

    def test_large_file_rejected(self):
        (self.app.workspace / "large.txt").write_text("x"*100001)
        with self.assertRaises(ValueError):
            self.app.tool({"operation":"read_file","path":"large.txt"})

    def test_arithmetic_is_not_code_execution(self):
        self.assertEqual(calculate("(15+5)*3"),60)
        for expression in ("__import__('os').getcwd()", "2**100000", "1/0", "True", "(-1)**0.5"):
            with self.subTest(expression=expression), self.assertRaises((ValueError,ZeroDivisionError)):
                calculate(expression)

    def test_url_schemes_and_credentials_rejected(self):
        for url in ("file:///etc/passwd","javascript:alert(1)","https://a:b@example.com"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                valid_url(url)
        self.assertEqual(valid_url("https://example.com"),"https://example.com")

    def test_actions_require_approval_and_execute_once(self):
        with patch("jarvis.webbrowser.open", return_value=True) as browser:
            action = self.app.tool({"operation":"open_url","text":"https://example.com"})
            browser.assert_not_called()
            self.assertEqual(action["status"],"pending")
            self.assertEqual(self.app.resolve_action(action["id"],True)["status"],"completed")
            browser.assert_called_once_with("https://example.com")
            with self.assertRaises(ValueError):
                self.app.resolve_action(action["id"],True)
            browser.assert_called_once()

    def test_rejected_action_does_not_execute(self):
        with patch("jarvis.webbrowser.open") as browser:
            action = self.app.tool({"operation":"open_url","text":"https://example.com"})
            self.app.resolve_action(action["id"],False)
            browser.assert_not_called()

    def test_browser_failure_is_recorded(self):
        with patch("jarvis.webbrowser.open",return_value=False):
            action = self.app.tool({"operation":"open_url","text":"https://example.com"})
            self.assertEqual(self.app.resolve_action(action["id"],True)["status"],"failed")

    def test_app_allowlist_and_no_shell(self):
        with patch("jarvis.platform.system",return_value="Windows"), patch("jarvis.subprocess.Popen") as launch:
            with self.assertRaises(ValueError):
                self.app.tool({"operation":"launch_app","text":"cmd.exe /c whoami"})
            action = self.app.tool({"operation":"launch_app","text":"calculator"})
            launch.assert_not_called()
            self.app.resolve_action(action["id"],True)
            self.assertFalse(launch.call_args.kwargs["shell"])
            self.assertEqual(len(launch.call_args.args[0]),1)

    def test_key_never_persisted_or_returned(self):
        self.app.configure({"provider":"openai","model":"example-model","api_key":"private-test-key"})
        self.assertNotIn("private-test-key", self.app.config_path.read_text())
        self.assertNotIn("private-test-key",json.dumps(self.app.state()))
        self.assertTrue(self.app.settings()["has_key"])
        self.app.configure({"provider":"commands","model":"example","clear_key":True})
        self.assertFalse(self.app.settings()["has_key"])

    def test_local_commands_and_reminders(self):
        self.assertIn("60",self.app.chat("/calc 12*5")["answer"])
        self.app.chat("/remind 10m Take a break")
        self.assertEqual(self.app.state()["tasks"][0]["title"],"Take a break")
        self.assertEqual(len(self.app.state()["messages"]),4)

    def test_tool_call_roundtrip(self):
        self.app.config["provider"] = "ollama"
        tool_response = {"role":"assistant","content":None,"tool_calls":[{
            "id":"call_1","type":"function","function":{"name":"jarvis_tool",
            "arguments":json.dumps({"operation":"add_task","text":"Run regression"})}}]}
        with patch.object(self.app,"completion",side_effect=[tool_response,{"role":"assistant","content":"Task saved."}]) as ai:
            self.assertEqual(self.app.chat("Add regression to my tasks")["answer"],"Task saved.")
            self.assertEqual(self.app.state()["tasks"][0]["title"],"Run regression")
            messages = ai.call_args.args[0]
            self.assertEqual(messages[-1]["role"],"tool")
            self.assertIn("task_id",messages[-1]["content"])

    def test_provider_failure_is_visible_and_saved(self):
        self.app.config["provider"] = "ollama"
        with patch.object(self.app,"completion",side_effect=ValueError("Cannot reach AI provider")):
            result = self.app.chat("hello")
        self.assertIn("Cannot reach",result["answer"])
        self.assertEqual(self.app.state()["messages"][-1]["content"],result["answer"])

    def test_invalid_tool_arguments_do_not_abort_tool_loop(self):
        self.app.config["provider"] = "ollama"
        response = {"role":"assistant","content":None,"tool_calls":[{
            "id":"broken","type":"function","function":{"name":"jarvis_tool","arguments":"not-json"}}]}
        with patch.object(self.app,"completion",side_effect=[response,{"role":"assistant","content":"Invalid request."}]) as ai:
            self.app.chat("test")
            self.assertIn("error",ai.call_args.args[0][-1]["content"])

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = Server(("127.0.0.1",0), Handler)
        self.server.app = Jarvis(self.temp.name)
        self.server.token = secrets.token_urlsafe(32)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:%s" % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self,path,method="GET",body=None,headers=None):
        connection = http.client.HTTPConnection("127.0.0.1",self.server.server_port,timeout=5)
        connection.request(method,path,body,headers or {})
        response = connection.getresponse()
        result = response.status,response.read(),dict(response.getheaders())
        connection.close()
        return result

    def auth_headers(self):
        return {"Cookie":"jarvis="+self.server.token,"Origin":self.origin,"Content-Type":"application/json"}

    def test_launch_cookie_and_static_assets(self):
        self.assertEqual(self.request("/")[0],401)
        status,body,headers = self.request("/?token="+self.server.token)
        self.assertEqual(status,200)
        self.assertIn(b"JARVIS",body)
        self.assertIn("HttpOnly",headers["Set-Cookie"])
        self.assertIn("frame-ancestors 'none'",headers["Content-Security-Policy"])
        self.assertEqual(self.request("/app.js",headers=self.auth_headers())[0],200)

    def test_api_auth_and_origin_and_host(self):
        self.assertEqual(self.request("/api/state")[0],401)
        headers = self.auth_headers()
        headers["Origin"]="https://evil.example"
        self.assertEqual(self.request("/api/chat","POST",'{"text":"/time"}',headers)[0],403)
        headers = self.auth_headers()
        headers["Host"]="evil.example"
        self.assertEqual(self.request("/api/state",headers=headers)[0],403)

    def test_http_chat_and_validation(self):
        status,body,_=self.request("/api/chat","POST",'{"text":"/calc 6*7"}',self.auth_headers())
        self.assertEqual(status,200)
        self.assertIn("42",json.loads(body)["answer"])
        self.assertEqual(self.request("/api/chat","POST",'[]',self.auth_headers())[0],400)
        self.assertEqual(self.request("/api/chat","POST",'{"text":""}',self.auth_headers())[0],400)

if __name__ == "__main__":
    unittest.main()
