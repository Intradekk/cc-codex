"""Check the Windows launcher's cwd/exit codes and the rebuild failure path."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == "nt", "Windows CMD scripts")
class CcCmdTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cc launcher test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.caller = self.root / "caller directory"
        self.caller.mkdir()
        self.launcher = self.root / "cc.cmd"
        shutil.copyfile(ROOT / "cc.cmd", self.launcher)

    def run_cmd(self, script, *args):
        return subprocess.run(
            [os.environ["COMSPEC"], "/d", "/c", "call", str(script), *args],
            cwd=self.caller,
            capture_output=True,
            text=True,
        )

    def test_launcher_preserves_cwd_and_exit_code(self):
        executable = self.root / "codex-rs/target/debug/codex.exe"
        executable.parent.mkdir(parents=True)
        # cmd.exe stands in for Codex to report its actual cwd and return a chosen code.
        shutil.copyfile(os.environ["COMSPEC"], executable)
        result = self.run_cmd(self.launcher, "/d", "/c", "cd")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), self.caller)
        result = self.run_cmd(self.launcher, "/d", "/c", "exit", "17")
        self.assertEqual(result.returncode, 17, result.stderr)

    def test_missing_executable_reports_rebuild_command(self):
        result = self.run_cmd(self.launcher, "--version")
        self.assertEqual(result.returncode, 1)
        self.assertIn("build-cc.cmd", result.stderr)

    def test_rebuild_propagates_cargo_failure(self):
        if not (Path.home() / ".cargo/bin/cargo.exe").is_file() and not shutil.which("cargo.exe"):
            self.skipTest("Cargo is not installed")
        script = self.root / "build-cc.cmd"
        shutil.copyfile(ROOT / "build-cc.cmd", script)
        workspace = self.root / "codex-rs"
        workspace.mkdir()
        (workspace / "Cargo.toml").write_text("[package\n", encoding="utf-8")
        result = self.run_cmd(script)
        self.assertEqual(result.returncode, 101, result.stderr)
        self.assertIn("Build failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
