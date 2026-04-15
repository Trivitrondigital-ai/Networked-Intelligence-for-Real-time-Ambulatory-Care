FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY services/emr_service/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY services /app/services
ENV PYTHONPATH=/app/services/emr_service/src

EXPOSE 8013
CMD ["uvicorn", "emr_service.main:app", "--host", "0.0.0.0", "--port", "8013"]
