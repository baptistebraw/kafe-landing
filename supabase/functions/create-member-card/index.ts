// Edge Function — create-member-card
//
// Crée une carte fidélité "member" (5%) à la volée, sans code pré-généré.
// Appelée par join.html — permet des inscriptions illimitées via un QR permanent.
//
// Variables d'env requises (même projet Supabase que kafe-loyalty) :
//   SUPABASE_URL              → injectée automatiquement
//   SUPABASE_SERVICE_ROLE_KEY → injectée automatiquement
//   WALLETWALLET_API_KEY      → à ajouter dans Supabase > Edge Functions > Secrets

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { firstname, lastname, email } = await req.json();

    if (!firstname || !lastname || !email) {
      return new Response(
        JSON.stringify({ error: 'Champs manquants : firstname, lastname, email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Client Supabase avec service role (peut insérer sans RLS)
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Vérifier doublon email
    const { data: existing } = await sb
      .from('loyalty_cards')
      .select('id')
      .eq('client_email', email)
      .single();

    if (existing) {
      return new Response(
        JSON.stringify({ error: 'email_already_exists' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Générer un code unique
    const code = crypto.randomUUID();

    // Créer + activer la carte directement
    const { error: insertError } = await sb.from('loyalty_cards').insert({
      code,
      tier:              'member',
      discount:          5,
      status:            'active',
      client_firstname:  firstname,
      client_lastname:   lastname,
      client_email:      email,
      activated_at:      new Date().toISOString(),
    });

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Erreur lors de la création de la carte' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Générer le pkpass via WalletWallet (optionnel — la carte existe même sans)
    let pkpass: string | null = null;
    try {
      const WALLETWALLET_API_KEY = Deno.env.get('WALLETWALLET_API_KEY') ?? '';

      const passResp = await fetch('https://api.walletwallet.dev/api/pkpass', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WALLETWALLET_API_KEY}`,
        },
        body: JSON.stringify({
          barcodeValue:   code,
          barcodeFormat:  'QR',
          title:          'Kafé — Carte membre',
          label:          `${firstname} ${lastname}`,
          value:          'Member −5%',
          color:          '#7a9e8f',
          expirationDays: 365,
        }),
      });

      if (passResp.ok) {
        const json = await passResp.json();
        pkpass = json.pkpass ?? null;
      }
    } catch (e) {
      console.warn('WalletWallet error (non-bloquant):', e);
    }

    return new Response(
      JSON.stringify({ success: true, pkpass }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    console.error('Unexpected error:', e);
    return new Response(
      JSON.stringify({ error: 'Erreur interne' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
