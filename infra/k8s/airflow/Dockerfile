FROM apache/airflow:2.8.1-python3.11
USER root
COPY libgomp1_12.2.0-14+deb12u1_amd64.deb /tmp/libgomp1.deb
RUN dpkg-deb -x /tmp/libgomp1.deb /tmp/libgomp-extract && \
    cp /tmp/libgomp-extract/usr/lib/x86_64-linux-gnu/libgomp.so.1.0.0 /usr/lib/x86_64-linux-gnu/ && \
    cp /tmp/libgomp-extract/usr/lib/x86_64-linux-gnu/libgomp.so.1 /usr/lib/x86_64-linux-gnu/ && \
    ldconfig && \
    rm -rf /tmp/libgomp-extract /tmp/libgomp1.deb
USER airflow
WORKDIR /opt/airflow
