import asyncio
from main import Batcher, make_flush_fn


def _rows(n=1):
    return [{"span_id": str(i)} for i in range(n)]


class FakeMessage:
    def __init__(self):
        self.acked = False

    async def ack(self):
        self.acked = True


async def test_flush_triggers_when_batch_size_reached():
    inserted = []

    async def flush_fn(rows, messages):
        inserted.extend(rows)
        for m in messages:
            await m.ack()

    batcher = Batcher(batch_size=3, flush_fn=flush_fn)
    msgs = [FakeMessage() for _ in range(3)]

    await batcher.add(_rows(1), msgs[0])
    await batcher.add(_rows(1), msgs[1])
    assert inserted == []  # not flushed yet

    await batcher.add(_rows(1), msgs[2])
    assert len(inserted) == 3
    assert all(m.acked for m in msgs)


async def test_flush_triggers_after_timeout_with_partial_buffer():
    inserted = []

    async def flush_fn(rows, messages):
        inserted.extend(rows)
        for m in messages:
            await m.ack()

    batcher = Batcher(batch_size=100, flush_fn=flush_fn)
    msg = FakeMessage()
    await batcher.add(_rows(1), msg)
    assert inserted == []  # not yet

    task = asyncio.create_task(batcher.start_timer(interval=0.05))
    await asyncio.sleep(0.15)
    task.cancel()

    assert len(inserted) == 1
    assert msg.acked


async def test_flush_with_empty_buffer_does_not_call_flush_fn():
    called = []

    async def flush_fn(rows, messages):
        called.append(True)

    batcher = Batcher(batch_size=10, flush_fn=flush_fn)
    await batcher.flush()
    assert called == []


async def test_empty_rows_do_not_count_toward_batch_size():
    inserted = []

    async def flush_fn(rows, messages):
        inserted.extend(rows)

    batcher = Batcher(batch_size=2, flush_fn=flush_fn)
    msg = FakeMessage()

    await batcher.add([], msg)
    assert inserted == []


async def test_insert_is_retried_on_transient_failure():
    attempts = []
    msg = FakeMessage()

    def insert_fn(rows):
        attempts.append(1)
        if len(attempts) < 3:
            raise RuntimeError("transient error")

    flush_fn = make_flush_fn(insert_fn, retry_delays=[0, 0])
    await flush_fn(_rows(2), [msg])

    assert len(attempts) == 3
    assert msg.acked


async def test_messages_are_acked_after_all_retries_exhausted():
    msg = FakeMessage()

    def insert_fn(rows):
        raise RuntimeError("permanent error")

    flush_fn = make_flush_fn(insert_fn, retry_delays=[0, 0])
    await flush_fn(_rows(2), [msg])

    assert msg.acked


async def test_buffer_not_cleared_if_flush_fn_raises():
    async def flush_fn(rows, messages):
        raise RuntimeError("flush failed")

    batcher = Batcher(batch_size=10, flush_fn=flush_fn)
    msg = FakeMessage()
    await batcher.add(_rows(1), msg)

    try:
        await batcher.flush()
    except RuntimeError:
        pass

    assert not msg.acked
