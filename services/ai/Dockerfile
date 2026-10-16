FROM python:3.12-slim
WORKDIR /app
COPY services/ai/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/ai/app.py .
ENV HF_HOME=/models
VOLUME /models
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
