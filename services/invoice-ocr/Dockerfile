FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV HOME=/home/appuser
ENV XDG_CACHE_HOME=/home/appuser/.cache
ENV PADDLE_HOME=/home/appuser/.paddleocr

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libglib2.0-0 libsm6 libxext6 libxrender1 libxcb1 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip setuptools wheel \
    && pip install -r /app/requirements.txt

COPY app.py /app/app.py

RUN adduser --disabled-password --gecos "" appuser \
    && mkdir -p /home/appuser/.paddleocr /home/appuser/.cache \
    && chown -R appuser:appuser /app /home/appuser

USER appuser

RUN python -c "from app import _get_model; _get_model()"

EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--workers", "1", "--no-access-log"]
