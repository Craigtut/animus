-- Remove legacy SDK tool permission rows seeded by the old agents package
DELETE FROM tool_permissions WHERE tool_source LIKE 'sdk:%';
