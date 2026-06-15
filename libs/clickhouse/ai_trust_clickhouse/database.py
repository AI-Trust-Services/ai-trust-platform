import logging
import os

import clickhouse_connect

log = logging.getLogger(__name__)


def get_client():
    host = os.environ["CLICKHOUSE_HOST"]
    port = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
    log.info("Connecting to ClickHouse at %s:%s", host, port)
    return clickhouse_connect.get_client(
        host=host,
        port=port,
        username=os.environ["CLICKHOUSE_USER"],
        password=os.environ["CLICKHOUSE_PASSWORD"],
    )
