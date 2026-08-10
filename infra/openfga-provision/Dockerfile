FROM python:3.12-alpine

WORKDIR /app

# Shared authorization constants — single source of truth for the permission
# matrix and role definitions the model + tuples are generated from.
COPY libs/authorization /app/libs/authorization
RUN pip install --no-cache-dir -e /app/libs/authorization

COPY infra/openfga-provision/provision.py /app/provision.py

CMD ["python", "/app/provision.py"]
