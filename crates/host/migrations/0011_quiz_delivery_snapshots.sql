ALTER TABLE quiz_deliveries ADD COLUMN assigned_count INTEGER;

UPDATE quiz_deliveries
SET assigned_count = (
    SELECT count(*)
    FROM classroom_enrolments
    WHERE classroom_id = quiz_deliveries.classroom_id
)
WHERE assigned_count IS NULL;
