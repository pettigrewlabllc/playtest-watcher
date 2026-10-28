import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from situation import stage_info_of, stages_of  # noqa: E402

# Shared with tests/predict/stages.test.ts so the two stage maps stay identical.
CASES = json.loads((Path(__file__).parents[2] / "tests" / "fixtures" / "stages.json").read_text())


def test_matches_the_shared_fixture():
    for c in CASES:
        assert stages_of(c["events"], c["game"]) == c["stages"], c["game"]
        if "runs" in c:
            assert [r for _, r in stage_info_of(c["events"], c["game"])] == c["runs"]
