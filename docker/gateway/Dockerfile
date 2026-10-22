# The RantAI API gateway on its own (docker/backend/gateway.py: an API key + a model allowlist in
# front of an OpenAI-style server). The existing gateways run the copy baked into the backend
# image; this image exists so a gateway can pick up a newer gateway.py (for instance the
# GATEWAY_POST_PATHS support the decision gateway needs) without rebuilding a 17 GB backend image.
#
#   docker build -f docker/gateway/Dockerfile -t rantai-gateway:latest .
FROM python:3.12-slim
WORKDIR /opt/rantai
COPY docker/backend/gateway.py /opt/rantai/gateway.py
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
ENTRYPOINT ["python3", "/opt/rantai/gateway.py"]
