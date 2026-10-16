# Same Python minor version that requirements.txt is compiled against.
FROM python:3.13-slim

WORKDIR /app

# Hugging Face Spaces run the container as UID 1000, not root, so models,
# the dataset cache and the Chroma index all live under /app, owned by that user.
RUN useradd -m -u 1000 user
ENV HF_HOME=/app/.cache/huggingface

# Install the CPU-only PyTorch wheel first so sentence-transformers doesn't
# pull the multi-GB CUDA build. Keep in sync with torch== in requirements.txt.
ARG TORCH_VERSION=2.14.1
RUN pip install --no-cache-dir "torch==${TORCH_VERSION}" --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the embedding model and the reranker into the image so startup
# doesn't depend on downloading them from Hugging Face.
RUN python -c "from sentence_transformers import SentenceTransformer, CrossEncoder; \
SentenceTransformer('all-MiniLM-L6-v2'); CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"

COPY . .
RUN mkdir -p /app/chroma_factors_db && chown -R user:user /app
USER user

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
