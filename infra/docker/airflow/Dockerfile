FROM apache/airflow:3.1.1rc1-python3.11

USER root

# Java for Spark
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
    && ln -sfn "/usr/lib/jvm/java-17-openjdk-${arch}" /usr/lib/jvm/java-17-openjdk

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk

# Copy and setup dependencies
COPY requirements.txt /opt/airflow/requirements.txt
RUN chown airflow:0 /opt/airflow/requirements.txt

USER airflow
RUN pip install --no-cache-dir -r /opt/airflow/requirements.txt

# Set working directory
WORKDIR /opt/airflow
