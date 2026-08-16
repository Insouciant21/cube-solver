from __future__ import annotations

import subprocess
import sys


def test_solver_backend_imports_without_main_first() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import cube_api.solver_backend"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
