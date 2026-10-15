-- Run this file on its own, outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_issues_status_idx
ON order_issues (status);
