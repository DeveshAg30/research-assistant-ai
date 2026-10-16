# Research Assistant — AI service

FastAPI agent behind the Express server. There are two images:

| Image | Embeddings | Reranker | Index | RAM |
|---|---|---|---|---|
| `Dockerfile` | sentence-transformers (torch) | cross-encoder | built at startup, needs a persistent disk | ~1.5 GB |
| `Dockerfile.slim` | same MiniLM model via ONNX runtime | off | `prebuilt_index/`, shipped in the image | fits 512 MB |

`render.yaml` deploys the slim image on Render's free plan.

## Rebuilding the prebuilt index

Free instances have no persistent disk, so the slim image ships the Chroma
index in `prebuilt_index/`. Rebuild and commit it after changing the dataset
selection, the document schema (`INDEX_SCHEMA_VERSION`) or the embedding model:

```bash
EMBEDDING_PROVIDER=onnx CHROMA_PERSIST_DIR=./prebuilt_index python ingest.py --rows 10000 --rebuild
```

`--rows` must match `MAX_INGEST_ROWS` in `Dockerfile.slim`; otherwise the
service treats the index as stale and rebuilds it at startup.
