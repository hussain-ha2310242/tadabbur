FROM python:3.11-slim

# camel-tools pulls in camel-kenlm, which may build from source on arm64
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake libboost-all-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Morphology DB + MLE disambiguator data (~light bundle), baked into the image
RUN camel_data -i light

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
