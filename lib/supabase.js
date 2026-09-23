import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://pbpyqpioqngrenihmdnc.supabase.co";

const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_c_d5vNS2a3p21xJIX6OyEQ_JYm_SwR9";

export const supabase = createClient(url, key);
