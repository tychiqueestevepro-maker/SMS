SELECT phone_e164 FROM contacts WHERE phone_e164 !~ '^\+[1-9]\d{1,14}$';
