FROM python:3.12.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY windows/reel-inbox/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY windows/reel-inbox/helper.py inbox_helper.py
COPY cloud/model-worker/worker.py worker.py
RUN useradd --uid 10001 --create-home worker && mkdir /data && chown worker:worker /data
USER 10001:10001
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
CMD ["python", "worker.py"]
