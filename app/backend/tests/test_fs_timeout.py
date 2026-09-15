import time

import pytest

from resilience.fs_timeout import FsTimeoutError, run_with_timeout


def test_run_with_timeout_ok():
    assert run_with_timeout(lambda: 7, timeout_sec=1, label="ok") == 7


def test_run_with_timeout_expires():
    with pytest.raises(FsTimeoutError):
        run_with_timeout(lambda: time.sleep(2), timeout_sec=0.2, label="sleep")
