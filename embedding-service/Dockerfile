FROM python:3.12-slim

WORKDIR /app

COPY libs/logging /app/libs/logging
COPY embedding-service/requirements.txt .
# CPU-only torch: the default PyPI torch wheel bundles ~2.5 GB of CUDA/nvidia
# libraries this CPU-inference service never uses. Install the CPU build from
# PyTorch's CPU index BEFORE the requirements so sentence-transformers resolves
# against it instead of pulling the CUDA wheel.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY embedding-service/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
