ALTER TABLE public.contacts ADD COLUMN has_unread_messages boolean NOT NULL DEFAULT false;

-- Create function to update contact on inbound message
CREATE OR REPLACE FUNCTION public.set_contact_unread_on_inbound_message()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE public.contacts SET has_unread_messages = true WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for incoming messages
DROP TRIGGER IF EXISTS on_inbound_message ON public.messages;
CREATE TRIGGER on_inbound_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.set_contact_unread_on_inbound_message();
