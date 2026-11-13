FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 xingtu && useradd -u 10001 -g xingtu -M xingtu \
    && mkdir /data && chown xingtu:xingtu /data
COPY deployment/requirements-contract.txt /app/deployment/requirements-contract.txt
RUN python3 -m venv /opt/xingtu-python \
    && /opt/xingtu-python/bin/pip install --no-cache-dir -r /app/deployment/requirements-contract.txt
COPY deployment/ /app/deployment/
COPY xingtu-server.jar /app/xingtu-server.jar
USER 10001:10001
ENV XT_BIND=0.0.0.0 XT_PORT=22648 XT_DATA_DIR=/data XT_LEGACY_MODE=disabled XT_CONTRACT_PYTHON=/opt/xingtu-python/bin/python
VOLUME ["/data"]
EXPOSE 22648
ENTRYPOINT ["java","-Dfile.encoding=UTF-8","-jar","/app/xingtu-server.jar"]
