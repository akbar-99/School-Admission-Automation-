-- ============================================================================
-- Extended admission form fields: curriculum, residence/addresses, both
-- parents' details, and a Grade-only preferred assessment date request.
-- ============================================================================

alter table students
  add column if not exists curriculum           text,
  add column if not exists country_of_residence text,
  add column if not exists current_address      text,
  add column if not exists permanent_address    text,
  add column if not exists father_name          text,
  add column if not exists father_phone         text,
  add column if not exists mother_name          text,
  add column if not exists mother_phone         text;

-- Parent-requested assessment dates (Grade only). These are a *request*; the
-- actual slot is still booked/confirmed through assessment_slots.
alter table applications
  add column if not exists preferred_assessment_date     date,
  add column if not exists preferred_assessment_date_alt date;
