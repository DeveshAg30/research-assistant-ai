---
title: Research Assistant AI
emoji: 🔎
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8000
# The Chroma index is built on first boot (free Spaces have no persistent disk).
startup_duration_timeout: 1h
pinned: false
---

# Research Assistant — AI service

FastAPI agent behind the Express server. The header above configures it as a
Hugging Face Docker Space (free CPU Basic: 2 vCPU, 16 GB RAM).

## Deploy to a Hugging Face Space

1. Create a Space at https://huggingface.co/new-space: SDK **Docker**,
   template **Blank**, hardware **CPU basic (free)**, visibility **Public**
   (the Express server can't send a Hugging Face token to a private Space).
2. In the Space's **Settings → Variables and secrets**, add these secrets:
   - `GOOGLE_API_KEY` (required)
   - `AI_SERVICE_TOKEN`: a long random string; the Express server must use the same value.
     Without it, anyone could call the agent with your API keys.
   - `TAVILY_API_KEY` (optional)
3. From the repo root, push just this folder to the Space:

   ```bash
   git subtree split --prefix ai-service -b hf-space
   git push --force https://<hf-user>:<hf-write-token>@huggingface.co/spaces/<hf-user>/<space-name> hf-space:main
   git branch -D hf-space
   ```

The first boot downloads the dataset and builds the index, which takes several
minutes. The Space shows **Running** once `GET /health` responds. Its URL is
`https://<hf-user>-<space-name>.hf.space`; set it as `AI_SERVICE_URL` on the server.

Free Spaces sleep after 48 h without traffic and lose the index on restart, so
the first request after that waits for a rebuild.
