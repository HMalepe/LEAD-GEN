-- 0003: separate migration because Postgres forbids using an enum value
-- ('handoff', added in 0002) in the same transaction that adds it.

-- Human-handoff work queue: what the ops team watches.
create or replace view handoff_queue as
select id as lead_id, full_name, phone_e164, handoffs[array_upper(handoffs, 1)] as reason, updated_at
from leads
where status = 'handoff' and erased_at is null
order by updated_at;
