FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY services/ai_service/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY services /app/services
ENV PYTHONPATH=/app/services/shared/src:/app/services/ai_service/src

EXPOSE 8011
CMD ["uvicorn", "ai_service.main:app", "--host", "0.0.0.0", "--port", "8011"]
