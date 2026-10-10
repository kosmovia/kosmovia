#![cfg(test)]

//! Lo que se prueba acá no es el camino feliz (eso es lo fácil), sino que la
//! plata no pueda salir por donde no debe ni quedar encerrada: cobrar sin meta,
//! cobrar dos veces, cobrar fuera de plazo, reembolsar antes de tiempo,
//! reembolsar dos veces, aportar después del cierre, y que `raised` nunca
//! muestre plata que ya se fue.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, IntoVal,
};

struct Setup {
    env: Env,
    client: VaquitaClient<'static>,
    token: token::Client<'static>,
    beneficiary: Address,
    ana: Address,
    beto: Address,
}

const GOAL: i128 = 100;
const START: u64 = 1_000;
const DEADLINE: u64 = START + 10_000;
/// 15 días en segundos, igual que GRACE_SECS del contrato.
const GRACE: u64 = 15 * 24 * 60 * 60;

/// Vaquita con meta 100 y dos aportantes con 500 cada uno.
fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = START);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let mint = token::StellarAssetClient::new(&env, &token_id);
    let token = token::Client::new(&env, &token_id);

    let beneficiary = Address::generate(&env);
    let ana = Address::generate(&env);
    let beto = Address::generate(&env);
    mint.mint(&ana, &500);
    mint.mint(&beto, &500);

    let contract_id = env.register(
        Vaquita,
        (beneficiary.clone(), token_id.clone(), GOAL, DEADLINE),
    );
    let client = VaquitaClient::new(&env, &contract_id);

    Setup { env, client, token, beneficiary, ana, beto }
}

// ------------------------------------------------------------------ términos

#[test]
fn los_terminos_quedan_fijos_desde_el_despliegue() {
    let s = setup();
    let pot = s.client.state();
    assert_eq!(pot.beneficiary, s.beneficiary);
    assert_eq!(pot.goal, GOAL);
    assert_eq!(pot.deadline, DEADLINE);
    assert_eq!(pot.raised, 0);
    assert!(!pot.claimed);
    // No hay `init` público: nadie puede re-inicializar ni adelantarse a hacerlo.
    assert_eq!(s.client.claim_deadline(), DEADLINE + GRACE);
}

/// Un constructor que devuelve Err hace panic al registrar, así que cada término
/// inválido va en su propio test.
fn registrar_con(goal: i128, deadline: u64) {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = START);
    let who = Address::generate(&env);
    env.register(Vaquita, (who.clone(), who, goal, deadline));
}

#[test]
#[should_panic]
fn el_constructor_rechaza_meta_cero() {
    registrar_con(0, DEADLINE);
}

#[test]
#[should_panic]
fn el_constructor_rechaza_un_plazo_ya_vencido() {
    registrar_con(100, START - 1);
}

#[test]
#[should_panic]
fn el_constructor_rechaza_un_plazo_demasiado_lejano() {
    // Más de 60 días: el estado se archivaría antes de que alguien pueda retirar.
    registrar_con(100, START + 61 * 24 * 60 * 60);
}

// ------------------------------------------------------------------ aportes

#[test]
fn aportar_mueve_el_token_al_contrato_y_acumula() {
    let s = setup();
    assert_eq!(s.client.contribute(&s.ana, &30), 30);
    // Aportar de nuevo suma: el reembolso devuelve el total, no el último.
    assert_eq!(s.client.contribute(&s.ana, &20), 50);
    assert_eq!(s.client.contributed(&s.ana), 50);
    assert_eq!(s.client.state().raised, 50);
    assert_eq!(s.token.balance(&s.ana), 450);
    assert_eq!(s.token.balance(&s.client.address), 50);
}

#[test]
fn no_se_aporta_cero_ni_negativo() {
    let s = setup();
    assert_eq!(s.client.try_contribute(&s.ana, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(s.client.try_contribute(&s.ana, &-5), Err(Ok(Error::InvalidAmount)));
}

#[test]
fn no_se_aporta_despues_del_plazo() {
    let s = setup();
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    assert_eq!(s.client.try_contribute(&s.ana, &10), Err(Ok(Error::Expired)));
}

#[test]
fn no_se_aporta_despues_de_cobrada() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    s.client.claim();
    assert_eq!(s.client.try_contribute(&s.beto, &10), Err(Ok(Error::AlreadyClaimed)));
}

#[test]
fn un_aporte_fallido_no_deja_rastro() {
    let s = setup();
    // Ana tiene 500: pedir 600 hace fallar la transferencia del token.
    assert!(s.client.try_contribute(&s.ana, &600).is_err());
    // La invocación se revierte entera: ni share ni raised quedaron escritos.
    assert_eq!(s.client.contributed(&s.ana), 0);
    assert_eq!(s.client.state().raised, 0);
    assert_eq!(s.token.balance(&s.client.address), 0);
}

// ------------------------------------------------------------------ cobro

#[test]
fn el_beneficiario_cobra_al_alcanzar_la_meta_sin_esperar_el_plazo() {
    let s = setup();
    s.client.contribute(&s.ana, &60);
    s.client.contribute(&s.beto, &40);
    assert_eq!(s.client.claim(), 100);
    assert_eq!(s.token.balance(&s.beneficiary), 100);
    assert_eq!(s.token.balance(&s.client.address), 0);
    assert!(s.client.state().claimed);
}

#[test]
fn el_beneficiario_puede_cobrar_despues_del_plazo_dentro_de_la_ventana() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    // `claim` no mira `deadline`, solo la ventana de cobro: fijamos esa invariante
    // para que un refactor que agregue el check trabe los botes exitosos.
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + GRACE);
    assert_eq!(s.client.claim(), GOAL);
    assert_eq!(s.token.balance(&s.beneficiary), GOAL);
}

#[test]
fn no_se_cobra_sin_alcanzar_la_meta() {
    let s = setup();
    s.client.contribute(&s.ana, &99);
    assert_eq!(s.client.try_claim(), Err(Ok(Error::GoalNotReached)));
    assert_eq!(s.token.balance(&s.beneficiary), 0);
}

#[test]
fn no_se_cobra_dos_veces() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    s.client.claim();
    assert_eq!(s.client.try_claim(), Err(Ok(Error::AlreadyClaimed)));
    assert_eq!(s.token.balance(&s.client.address), 0);
}

#[test]
fn un_aporte_de_mas_se_cobra_completo() {
    let s = setup();
    s.client.contribute(&s.ana, &150);
    assert_eq!(s.client.claim(), 150);
    assert_eq!(s.token.balance(&s.beneficiary), 150);
}

// ------------------------------------------------------------------ reembolso

#[test]
fn vencido_sin_meta_cada_quien_retira_lo_suyo() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    s.client.contribute(&s.beto, &20);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);

    assert_eq!(s.client.refund(&s.ana), 30);
    assert_eq!(s.client.refund(&s.beto), 20);
    assert_eq!(s.token.balance(&s.ana), 500);
    assert_eq!(s.token.balance(&s.beto), 500);
    assert_eq!(s.token.balance(&s.client.address), 0);
}

#[test]
fn raised_y_saldo_coinciden_despues_de_un_reembolso_parcial() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    s.client.contribute(&s.beto, &20);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);

    s.client.refund(&s.ana);
    // `raised` baja con el reembolso: el progreso que ve la app no miente, y el
    // total sigue coincidiendo con el saldo real del contrato.
    assert_eq!(s.client.state().raised, 20);
    assert_eq!(s.token.balance(&s.client.address), 20);
    assert_eq!(s.client.contributed(&s.ana), 0);
    assert_eq!(s.client.contributed(&s.beto), 20);
}

#[test]
fn no_se_reembolsa_antes_del_plazo() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    assert_eq!(s.client.try_refund(&s.ana), Err(Ok(Error::NotExpiredYet)));
}

#[test]
fn con_la_meta_alcanzada_hay_que_esperar_la_ventana_de_cobro() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    assert_eq!(s.client.try_refund(&s.ana), Err(Ok(Error::GoalWasReached)));
}

#[test]
fn si_el_beneficiario_no_cobra_la_plata_vuelve_a_los_aportantes() {
    let s = setup();
    s.client.contribute(&s.ana, &60);
    s.client.contribute(&s.beto, &40); // meta alcanzada
    // Pasó el plazo y toda la ventana de cobro sin que el beneficiario cobrara:
    // sin esta salida, el bote quedaba encerrado para siempre.
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + GRACE + 1);

    assert_eq!(s.client.try_claim(), Err(Ok(Error::ClaimWindowClosed)));
    assert_eq!(s.client.refund(&s.ana), 60);
    assert_eq!(s.client.refund(&s.beto), 40);
    assert_eq!(s.token.balance(&s.ana), 500);
    assert_eq!(s.token.balance(&s.beto), 500);
    assert_eq!(s.token.balance(&s.client.address), 0);
    assert_eq!(s.token.balance(&s.beneficiary), 0);
}

#[test]
fn no_se_reembolsa_dos_veces() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    s.client.refund(&s.ana);
    assert_eq!(s.client.try_refund(&s.ana), Err(Ok(Error::NothingToRefund)));
    assert_eq!(s.token.balance(&s.ana), 500);
}

#[test]
fn quien_no_aporto_no_retira_nada() {
    let s = setup();
    s.client.contribute(&s.ana, &30);
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + 1);
    assert_eq!(s.client.try_refund(&s.beto), Err(Ok(Error::NothingToRefund)));
}

#[test]
fn cobrada_no_deja_reembolsar_aunque_pase_el_plazo() {
    let s = setup();
    s.client.contribute(&s.ana, &GOAL);
    s.client.claim();
    s.env.ledger().with_mut(|l| l.timestamp = DEADLINE + GRACE + 1);
    assert_eq!(s.client.try_refund(&s.ana), Err(Ok(Error::AlreadyClaimed)));
}

// ------------------------------------------------------------------ permisos

#[test]
fn sin_autorizacion_no_se_mueve_nada() {
    let s = setup();
    s.client.contribute(&s.ana, &10);

    // Se arma con permisos (acuñar y aportar los necesitan) y recién acá se
    // exige autorización de verdad: sin firma, nadie mueve plata ajena.
    s.env.set_auths(&[]);
    assert!(s.client.try_contribute(&s.ana, &10).is_err());
    assert!(s.client.try_claim().is_err());
    assert!(s.client.try_refund(&s.ana).is_err());
    assert_eq!(s.token.balance(&s.client.address), 10);
}

#[test]
fn el_aporte_exige_la_firma_del_aportante_por_el_monto_exacto() {
    let s = setup();
    s.env.set_auths(&[]);
    // Autorizado por Ana para 10: no sirve para que Beto aporte ni para otro monto.
    let auth = soroban_sdk::testutils::MockAuth {
        address: &s.ana,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &s.client.address,
            fn_name: "contribute",
            args: (s.ana.clone(), 10_i128).into_val(&s.env),
            sub_invokes: &[],
        },
    };
    assert!(s.client.mock_auths(&[auth.clone()]).try_contribute(&s.beto, &10).is_err());
    assert!(s.client.mock_auths(&[auth]).try_contribute(&s.ana, &99).is_err());
}

// ------------------------------------------------------------------ límite conocido

#[test]
fn un_aporte_directo_al_contrato_no_cuenta_y_queda_atrapado() {
    let s = setup();
    // Pagar a la dirección del contrato sin pasar por `contribute`: el bote no
    // lo registra y no hay forma de sacarlo. Límite conocido y documentado.
    s.token.transfer(&s.ana, &s.client.address, &40);
    assert_eq!(s.client.state().raised, 0);
    assert_eq!(s.client.contributed(&s.ana), 0);
    assert_eq!(s.token.balance(&s.client.address), 40);
}
