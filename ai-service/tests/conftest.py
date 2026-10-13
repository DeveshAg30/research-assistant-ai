import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Never pick up a developer's real keys / settings from .env during tests.
os.environ.setdefault("RERANKER_MODEL", "none")
os.environ["AI_SERVICE_TOKEN"] = "test-token"
