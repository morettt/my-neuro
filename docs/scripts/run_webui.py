"""Start Flask WebUI on a fixed port from the upstream clone."""
import os
import sys
from pathlib import Path

LIVE2D = Path(r"K:\neruo\my-neuro-docs\live-2d")
os.chdir(LIVE2D)
sys.path.insert(0, str(LIVE2D))

from webui.main_app import create_app  # noqa: E402

app = create_app()
print("WEBUI_READY http://127.0.0.1:8765 cloud=", __import__("webui.utils", fromlist=["IS_CLOUD_VERSION"]).IS_CLOUD_VERSION)
app.run(host="127.0.0.1", port=8765, debug=False, use_reloader=False)
