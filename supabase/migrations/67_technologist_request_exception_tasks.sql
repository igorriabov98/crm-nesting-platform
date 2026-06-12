-- Allows planning directors to review technologist request tasks completed without a submitted request.

ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'technologist_request_exception';
