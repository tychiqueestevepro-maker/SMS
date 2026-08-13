DO $$ 
DECLARE 
    v_user_id uuid;
    v_workspace_id uuid;
    v_phone_number_id uuid;
    v_contact1_id uuid;
    v_contact2_id uuid;
BEGIN
    -- Get user and workspace
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'test@riink.app' LIMIT 1;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    SELECT id INTO v_workspace_id FROM public.workspaces WHERE owner_id = v_user_id LIMIT 1;
    IF v_workspace_id IS NULL THEN
        RAISE EXCEPTION 'Workspace not found';
    END IF;

    -- Insert a phone number for the workspace if not exists
    SELECT id INTO v_phone_number_id FROM public.phone_numbers WHERE workspace_id = v_workspace_id LIMIT 1;
    IF v_phone_number_id IS NULL THEN
        INSERT INTO public.phone_numbers (workspace_id, phone_e164, status) 
        VALUES (v_workspace_id, '+12025550999', 'ready') 
        RETURNING id INTO v_phone_number_id;
    END IF;

    -- Get two existing contacts
    SELECT id INTO v_contact1_id FROM public.contacts WHERE workspace_id = v_workspace_id ORDER BY created_at ASC LIMIT 1;
    SELECT id INTO v_contact2_id FROM public.contacts WHERE workspace_id = v_workspace_id ORDER BY created_at ASC OFFSET 1 LIMIT 1;

    IF v_contact1_id IS NULL OR v_contact2_id IS NULL THEN
        RAISE EXCEPTION 'Not enough contacts. Run the seed script first.';
    END IF;

    -- Insert Messages
    INSERT INTO public.messages (
        workspace_id, contact_id, phone_number_id, direction, body, 
        dispatch_state, delivery_state, num_segments, created_at, accepted_at, received_at
    ) VALUES 
        (v_workspace_id, v_contact1_id, v_phone_number_id, 'inbound', 'Bonjour, j''aimerais plus d''informations.', 'accepted', 'delivered', 1, now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
        (v_workspace_id, v_contact1_id, v_phone_number_id, 'outbound', 'Bonjour ! Bien sûr, que souhaitez-vous savoir ?', 'accepted', 'delivered', 1, now() - interval '1 day', now() - interval '1 day', null),
        (v_workspace_id, v_contact1_id, v_phone_number_id, 'inbound', 'Quels sont vos horaires d''ouverture ?', 'accepted', 'delivered', 1, now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours'),
        (v_workspace_id, v_contact2_id, v_phone_number_id, 'outbound', 'Rappel de rendez-vous pour demain à 14h.', 'accepted', 'delivered', 1, now() - interval '3 days', now() - interval '3 days', null),
        (v_workspace_id, v_contact2_id, v_phone_number_id, 'inbound', 'Merci, je serai là.', 'accepted', 'delivered', 1, now() - interval '2 days', now() - interval '2 days', now() - interval '2 days');

END $$;
