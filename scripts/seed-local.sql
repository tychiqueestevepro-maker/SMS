DO $$ 
DECLARE 
    v_user_id uuid;
    v_workspace_id uuid;
    v_stage_id uuid;
    v_campaign1_id uuid;
    v_campaign2_id uuid;
BEGIN
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'test@riink.app' LIMIT 1;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Utilisateur introuvable. Veuillez créer le compte en vous inscrivant.';
    END IF;

    SELECT id INTO v_workspace_id FROM public.workspaces WHERE owner_id = v_user_id LIMIT 1;
    
    IF v_workspace_id IS NULL THEN
        INSERT INTO public.workspaces (owner_id) VALUES (v_user_id) RETURNING id INTO v_workspace_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE workspace_id = v_workspace_id) THEN
        INSERT INTO public.pipeline_stages (workspace_id, name, position, is_default) VALUES 
            (v_workspace_id, 'New', 1000, true),
            (v_workspace_id, 'Follow Up', 2000, false),
            (v_workspace_id, 'Converted', 3000, false);
    END IF;

    SELECT id INTO v_stage_id FROM public.pipeline_stages WHERE workspace_id = v_workspace_id ORDER BY position LIMIT 1;

    INSERT INTO public.contacts (workspace_id, first_name, last_name, phone_e164, country_code, pipeline_stage_id) VALUES
        (v_workspace_id, 'Jean', 'Dupont', '+12025550101', 'US', v_stage_id),
        (v_workspace_id, 'Marie', 'Curie', '+12025550102', 'US', v_stage_id),
        (v_workspace_id, 'Albert', 'Einstein', '+12025550103', 'US', v_stage_id),
        (v_workspace_id, 'Isaac', 'Newton', '+12025550104', 'US', v_stage_id),
        (v_workspace_id, 'Galileo', 'Galilei', '+12025550105', 'US', v_stage_id),
        (v_workspace_id, 'Nikola', 'Tesla', '+12025550106', 'US', v_stage_id),
        (v_workspace_id, 'Ada', 'Lovelace', '+12025550107', 'US', v_stage_id),
        (v_workspace_id, 'Charles', 'Darwin', '+12025550108', 'US', v_stage_id),
        (v_workspace_id, 'Louis', 'Pasteur', '+12025550109', 'US', v_stage_id),
        (v_workspace_id, 'Sigmund', 'Freud', '+12025550110', 'US', v_stage_id),
        (v_workspace_id, 'Grace', 'Hopper', '+12025550111', 'US', v_stage_id),
        (v_workspace_id, 'Alan', 'Turing', '+12025550112', 'US', v_stage_id),
        (v_workspace_id, 'Stephen', 'Hawking', '+12025550113', 'US', v_stage_id),
        (v_workspace_id, 'Jane', 'Goodall', '+12025550114', 'US', v_stage_id),
        (v_workspace_id, 'Neil', 'Armstrong', '+12025550115', 'US', v_stage_id);

    INSERT INTO public.campaigns (workspace_id, name, status) 
    VALUES (v_workspace_id, 'Promotion Été 2026', 'draft') RETURNING id INTO v_campaign1_id;
    
    INSERT INTO public.campaigns (workspace_id, name, status) 
    VALUES (v_workspace_id, 'Rappel de Rendez-vous', 'draft') RETURNING id INTO v_campaign2_id;

    INSERT INTO public.campaign_steps (campaign_id, step_order, body, wait_days_after_previous) VALUES
        (v_campaign1_id, 1, 'Bonjour {{first_name}}, c''est le moment de profiter de nos offres !', 0),
        (v_campaign1_id, 2, 'Dernière chance {{first_name}} ! L''offre expire ce soir.', 2),
        (v_campaign2_id, 1, 'Bonjour {{first_name}}, n''oubliez pas votre rendez-vous demain.', 0);

    INSERT INTO public.campaign_recipients (campaign_id, contact_id, workspace_id)
    SELECT v_campaign1_id, id, v_workspace_id FROM public.contacts WHERE workspace_id = v_workspace_id LIMIT 5;

END $$;
