import { createClient } from "@supabase/supabase-js";

async function run() {
  const supabase = createClient(
    "http://127.0.0.1:54321",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
  );
  const email = "test@riink.app";

  // 1. Get the user
  const { data: usersData, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) throw userError;
  let user = usersData.users.find((u: any) => u.email === email);
  
  if (!user) {
    console.log(`User ${email} not found. Creating user...`);
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: email,
      password: "password123",
      email_confirm: true,
      user_metadata: { full_name: "Tychique Esteve" }
    });
    if (createError) throw createError;
    user = newUser.user;
    console.log(`Created user with ID: ${user.id}`);
  }

  // 2. Get the workspace
  let workspace;
  
  // Retry fetching workspace since a DB trigger might take a moment to create it
  for (let i = 0; i < 3; i++) {
    const { data } = await supabase
      .from("workspaces")
      .select("*")
      .eq("owner_id", user.id)
      .maybeSingle();
      
    if (data) {
      workspace = data;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!workspace) {
    console.error(`Workspace for user ${email} not found even after creation.`);
    return;
  }

  const workspaceId = workspace.id;
  console.log(`Using Workspace: ${workspaceId} for ${email}`);

  // 4. Get pipeline stages
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("position");

  let stageIds = stages?.map((s: any) => s.id) || [];

  if (stageIds.length === 0) {
    console.log("Creating default pipeline stages...");
    const defaultStages = [
      { workspace_id: workspaceId, name: "New", position: 1000, is_default: true },
      { workspace_id: workspaceId, name: "Follow Up", position: 2000, is_default: false },
      { workspace_id: workspaceId, name: "Converted", position: 3000, is_default: false },
    ];
    const { data: newStages, error: stagesError } = await supabase
      .from("pipeline_stages")
      .insert(defaultStages)
      .select();
    if (stagesError) throw stagesError;
    stageIds = newStages.map((s: any) => s.id);
  }

  // 5. Create 15 Mock Contacts
  const names = [
    "Jean Dupont", "Marie Curie", "Albert Einstein", "Isaac Newton", 
    "Galileo Galilei", "Nikola Tesla", "Ada Lovelace", "Charles Darwin",
    "Louis Pasteur", "Sigmund Freud", "Grace Hopper", "Alan Turing",
    "Stephen Hawking", "Jane Goodall", "Neil Armstrong"
  ];
  
  const contactsToInsert = names.map((name, i) => {
    const stageId = stageIds.length > 0 ? stageIds[Math.floor(Math.random() * stageIds.length)] : null;
    return {
      workspace_id: workspaceId,
      first_name: name.split(" ")[0],
      last_name: name.split(" ")[1],
      phone_number: `+336${String(Math.floor(Math.random() * 90000000) + 10000000)}`,
      pipeline_stage_id: stageId,
      status: "active"
    };
  });

  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .insert(contactsToInsert)
    .select();

  if (contactsError) {
    console.error("Error inserting contacts:", contactsError);
    return;
  }
  
  console.log(`Inserted ${contacts.length} mock contacts.`);

  // 6. Create Mock Campaigns
  const campaignsToInsert = [
    {
      workspace_id: workspaceId,
      name: "Promotion Été 2026",
      status: "draft",
    },
    {
      workspace_id: workspaceId,
      name: "Rappel de Rendez-vous",
      status: "draft",
    }
  ];

  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaigns")
    .insert(campaignsToInsert)
    .select();

  if (campaignsError) {
    console.error("Error inserting campaigns:", campaignsError);
    return;
  }
  
  console.log(`Inserted ${campaigns.length} mock campaigns.`);

  // 7. Add Campaign Steps (Messages)
  for (const campaign of campaigns) {
    const steps = [
      {
        campaign_id: campaign.id,
        workspace_id: workspaceId,
        step_order: 1,
        body: `Bonjour {{first_name}}, c'est le moment de profiter de nos offres !`,
      },
      {
        campaign_id: campaign.id,
        workspace_id: workspaceId,
        step_order: 2,
        wait_days_after_previous: 2,
        body: `Dernière chance {{first_name}} ! L'offre expire ce soir.`,
      }
    ];

    const { error: stepsError } = await supabase.from("campaign_steps").insert(steps);
    if (stepsError) console.error("Error inserting steps:", stepsError);
  }
  
  console.log("Inserted mock campaign steps.");

  // 8. Associate contacts with campaigns
  for (const campaign of campaigns) {
    const contactLinks = contacts.slice(0, 5).map((c: any) => ({
      campaign_id: campaign.id,
      contact_id: c.id,
      workspace_id: workspaceId,
    }));
    const { error: assocError } = await supabase.from("campaign_contacts").insert(contactLinks);
    if (assocError) console.error("Error inserting campaign contacts:", assocError);
  }
  
  console.log("Associated contacts with campaigns.");
  console.log("Mock data insertion completed successfully!");
}

run().catch(console.error);
