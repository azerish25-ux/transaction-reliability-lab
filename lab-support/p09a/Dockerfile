# Deliberately separate from both normal application Dockerfiles.
FROM python:3.13.15-slim-bookworm
WORKDIR /app
COPY lab-support/p09a/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt \
    && groupadd --gid 10001 ledgerlab \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin ledgerlab \
    && mkdir /state && chown 10001:10001 /state
COPY --chown=10001:10001 lab-support/p09a/ /app/
RUN printf 'P09A disposable lab build only\n' > /app/LAB_ONLY_BUILD
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
CMD ["python", "server.py"]
