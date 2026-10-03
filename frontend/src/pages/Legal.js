import { useLang } from "@/context/LanguageContext";

const CONTACT_EMAIL = "contact@magicgame.store";
const UPDATED = { fr: "28 septembre 2026", en: "September 28, 2026" };

const TERMS = {
  fr: [
    ["1. Magic Game Store", ["Magic Game Store (MGS) est une boutique en ligne malgache de produits numériques pour PUBG Mobile : UC (Unknown Cash), abonnements Prime et Prime+, Packs évolutifs et offres événementielles. Le service est accessible sur https://magicgame.store."]],
    ["2. Acceptation des conditions", ["En passant une commande ou en créant un compte sur MGS, vous acceptez les présentes conditions. Si vous ne les acceptez pas, n'utilisez pas le service."]],
    ["3. Comptes utilisateurs", ["La création d'un compte demande une adresse email valide (vérification par email) et un mot de passe. Vous pouvez aussi commander en tant qu'invité en fournissant un email de contact.", "Vous êtes responsable de l'exactitude de votre ID PUBG Mobile et de la confidentialité de vos identifiants. Vous pouvez supprimer votre compte depuis votre espace client lorsqu'aucune commande n'est en cours."]],
    ["4. Produits numériques", ["Tous les produits vendus sont numériques et crédités directement sur le compte PUBG Mobile correspondant à l'ID indiqué lors de la commande. Aucun bien physique n'est expédié."]],
    ["5. Commandes", ["Chaque commande reçoit un numéro MGS permettant son suivi. Avant paiement, l'ID PUBG Mobile est vérifié auprès de notre fournisseur afin d'afficher le pseudo associé : c'est à vous de confirmer qu'il s'agit bien de votre compte.", "Certaines offres (abonnements Prime/Prime+, Packs évolutifs) sont limitées par ID PUBG Mobile et par période. Une commande peut être refusée si la limite est atteinte."]],
    ["6. Prix", ["Les prix sont affichés en ariary (MGA) et peuvent être modifiés à tout moment. Le prix applicable est celui affiché au moment de la commande."]],
    ["7. Paiements", ["Les paiements se font par Mobile Money (MVola, Orange Money), soit automatiquement via nos prestataires de paiement (PAPI, FiveOne Pay), soit manuellement par USSD avec envoi de la référence de transaction."]],
    ["8. Frais de paiement", ["Des frais de paiement peuvent s'ajouter au prix des produits et sont toujours affichés séparément avant validation :", "• USSD manuel : gratuit (0 MGA).", "• Paiement automatique : frais calculés selon le prestataire utilisé (pourcentage avec un minimum et un maximum).", "Le total à payer affiché au récapitulatif inclut ces frais."]],
    ["9. Livraison et exécution", ["Après confirmation du paiement, la commande est transmise automatiquement à notre fournisseur de recharge. La livraison est généralement rapide mais peut être retardée par le fournisseur ou par l'éditeur du jeu.", "Vous recevez des emails de suivi et pouvez consulter l'état de votre commande à tout moment via la page Suivi."]],
    ["10. Annulation", ["Une commande non payée peut expirer ou être annulée. Une commande déjà livrée ne peut pas être annulée, le produit étant crédité de manière irréversible sur le compte de jeu."]],
    ["11. Remboursement", ["Si un paiement est reçu mais que la livraison n'a pas pu être effectuée, MGS procède au remboursement ou à une livraison équivalente après vérification. Aucun remboursement n'est possible pour une erreur d'ID PUBG Mobile saisie par le client une fois le produit crédité. Toute réclamation doit nous être adressée via le chat du site ou WhatsApp."]],
    ["12. Utilisation interdite", ["Sont interdits : la fraude au paiement, l'usage de moyens de paiement volés, la revente non autorisée, les tentatives d'accès non autorisé au service, l'automatisation abusive et toute utilisation contraire aux règles de PUBG Mobile. MGS peut refuser ou bloquer une commande ou un compte en cas d'abus."]],
    ["13. Propriété intellectuelle", ["PUBG Mobile et ses contenus appartiennent à leurs éditeurs respectifs. MGS n'est pas affilié à Tencent, Krafton ou Level Infinite. La marque, le contenu et le code de MGS restent la propriété de Magic Game Store."]],
    ["14. Services tiers", ["MGS s'appuie sur des services tiers pour fonctionner : prestataires de paiement (PAPI, FiveOne Pay), fournisseur de recharge (FazerCards), envoi d'emails (Mailjet), hébergement (Render) et sécurité/réseau (Cloudflare). Leur indisponibilité peut affecter le service."]],
    ["15. Disponibilité", ["MGS est fourni « tel quel ». Nous visons une disponibilité continue mais ne garantissons pas l'absence d'interruption, de maintenance ou d'erreur."]],
    ["16. Modification des conditions", ["Ces conditions peuvent être modifiées à tout moment. La version publiée sur cette page prévaut, avec la date de mise à jour indiquée ci-dessous."]],
    ["17. Droit applicable", ["Les présentes conditions sont régies par le droit malgache. Tout litige relève des juridictions compétentes de Madagascar."]],
    ["18. Contact", [`Email : ${CONTACT_EMAIL} — WhatsApp : 037 75 198 33 — Téléphone : 038 39 056 92 — ou le chat support du site.`]],
  ],
  en: [
    ["1. Magic Game Store", ["Magic Game Store (MGS) is a Malagasy online store for PUBG Mobile digital products: UC (Unknown Cash), Prime and Prime+ subscriptions, Evolving Packs and event offers. The service runs at https://magicgame.store."]],
    ["2. Acceptance of terms", ["By placing an order or creating an account on MGS you accept these terms. If you do not accept them, please do not use the service."]],
    ["3. User accounts", ["Creating an account requires a valid email address (verified by email) and a password. You may also order as a guest by providing a contact email.", "You are responsible for the accuracy of your PUBG Mobile ID and for keeping your credentials confidential. You can delete your account from your customer area when no order is in progress."]],
    ["4. Digital products", ["All products are digital and credited directly to the PUBG Mobile account matching the ID given at checkout. No physical goods are shipped."]],
    ["5. Orders", ["Every order gets an MGS number used for tracking. Before payment your PUBG Mobile ID is verified with our supplier to display the matching nickname: it is up to you to confirm it is your account.", "Some offers (Prime/Prime+ subscriptions, Evolving Packs) are limited per PUBG Mobile ID and per period. An order may be rejected when a limit is reached."]],
    ["6. Prices", ["Prices are shown in ariary (MGA) and may change at any time. The applicable price is the one displayed when the order is placed."]],
    ["7. Payments", ["Payments are made with Mobile Money (MVola, Orange Money), either automatically through our payment providers (PAPI, FiveOne Pay) or manually via USSD by sending us the transaction reference."]],
    ["8. Payment fees", ["Payment fees may be added to the product price and are always shown separately before confirmation:", "• Manual USSD: free (0 MGA).", "• Automatic payment: fee computed from the provider used (percentage with a minimum and a maximum).", "The total to pay shown in the summary includes those fees."]],
    ["9. Delivery and fulfilment", ["Once payment is confirmed the order is sent automatically to our top-up supplier. Delivery is usually fast but may be delayed by the supplier or the game publisher.", "You receive tracking emails and can check your order status at any time on the Tracking page."]],
    ["10. Cancellation", ["An unpaid order may expire or be cancelled. A delivered order cannot be cancelled since the product is irreversibly credited to the game account."]],
    ["11. Refunds", ["If a payment is received but delivery could not be completed, MGS refunds you or delivers an equivalent product after verification. No refund is possible for a wrong PUBG Mobile ID entered by the customer once the product has been credited. Claims must be sent through the website chat or WhatsApp."]],
    ["12. Prohibited use", ["The following are prohibited: payment fraud, use of stolen payment methods, unauthorised resale, attempts to gain unauthorised access to the service, abusive automation and any use breaching PUBG Mobile rules. MGS may refuse or block an order or an account in case of abuse."]],
    ["13. Intellectual property", ["PUBG Mobile and its content belong to their respective publishers. MGS is not affiliated with Tencent, Krafton or Level Infinite. The MGS brand, content and code remain the property of Magic Game Store."]],
    ["14. Third-party services", ["MGS relies on third-party services: payment providers (PAPI, FiveOne Pay), top-up supplier (FazerCards), email delivery (Mailjet), hosting (Render) and network/security (Cloudflare). Their unavailability may affect the service."]],
    ["15. Availability", ["MGS is provided \"as is\". We aim for continuous availability but do not guarantee the absence of interruption, maintenance or error."]],
    ["16. Changes to these terms", ["These terms may change at any time. The version published on this page prevails, with the update date shown below."]],
    ["17. Governing law", ["These terms are governed by Malagasy law. Any dispute falls under the competent courts of Madagascar."]],
    ["18. Contact", [`Email: ${CONTACT_EMAIL} — WhatsApp: 037 75 198 33 — Phone: 038 39 056 92 — or the website support chat.`]],
  ],
};

const PRIVACY = {
  fr: [
    ["1. Données collectées", ["MGS ne collecte que les données nécessaires au traitement des commandes et au fonctionnement du compte client."]],
    ["2. Compte utilisateur", ["Email, nom ou pseudo, mot de passe (stocké sous forme chiffrée / hash), numéro de téléphone si vous le renseignez, IDs PUBG Mobile enregistrés, rôle (client ou administrateur) et statut de vérification de l'email."]],
    ["3. Commandes", ["Numéro de commande, ID PUBG Mobile, pseudo en jeu renvoyé par notre fournisseur, produits commandés, montants (prix, frais de paiement, total), mode de paiement, statut, historique des étapes et notes internes éventuelles."]],
    ["4. Paiement", ["Numéro de téléphone Mobile Money utilisé pour le paiement, référence de transaction, références du prestataire et statut du paiement. MGS ne stocke jamais de code PIN, de mot de passe Mobile Money ni de numéro de carte bancaire."]],
    ["5. Données techniques et journaux", ["Adresse IP (utilisée pour la limitation d'abus et la traçabilité des actions sensibles), horodatages, événements de paiement et journaux d'audit des actions administrateur."]],
    ["6. Cookies et stockage local", ["Un cookie de session sécurisé (httpOnly) permet de vous garder connecté. Le stockage local du navigateur conserve votre panier, votre langue (FR/EN) et votre thème (clair/sombre). Aucun cookie publicitaire ni de traçage tiers n'est utilisé."]],
    ["7. Notifications", ["Si vous acceptez les notifications push, un identifiant d'abonnement navigateur est enregistré pour vous informer de l'avancement de vos commandes. Vous pouvez les désactiver à tout moment."]],
    ["8. Services tiers", ["Vos données sont traitées par des prestataires strictement nécessaires : FazerCards (livraison de la recharge : ID PUBG Mobile et produit), PAPI et FiveOne Pay (paiement : montant, numéro payeur, référence), Mailjet (emails transactionnels : email et contenu de commande), Render (hébergement) et Cloudflare (domaine, sécurité réseau)."]],
    ["9. Conservation", ["Les données de commande sont conservées pour la comptabilité, le support et la lutte contre la fraude. Les données de compte sont conservées jusqu'à la suppression de votre compte ; les commandes déjà exécutées peuvent être conservées de manière anonymisée."]],
    ["10. Sécurité", ["Connexions chiffrées HTTPS, mots de passe hashés, sessions par cookie httpOnly, jetons d'email à usage unique et expirants, limitation du nombre de tentatives, vérification de signature des notifications de paiement et journal d'audit des actions administrateur."]],
    ["11. Partage", ["Aucune vente ni location de données. Le partage est limité aux prestataires ci-dessus et aux obligations légales."]],
    ["12. Vos droits", ["Vous pouvez consulter et corriger vos informations depuis votre espace client, demander la suppression de votre compte, ou nous contacter pour toute demande d'accès ou d'effacement conformément au droit malgache applicable."]],
    ["13. Contact", [`Email : ${CONTACT_EMAIL} — WhatsApp : 037 75 198 33 — Téléphone : 038 39 056 92.`]],
  ],
  en: [
    ["1. Data we collect", ["MGS only collects the data needed to process orders and run your customer account."]],
    ["2. User account", ["Email, name or nickname, password (stored hashed), phone number if you provide one, saved PUBG Mobile IDs, role (customer or administrator) and email verification status."]],
    ["3. Orders", ["Order number, PUBG Mobile ID, in-game nickname returned by our supplier, ordered products, amounts (price, payment fee, total), payment method, status, step history and possible internal notes."]],
    ["4. Payment", ["Mobile Money phone number used for the payment, transaction reference, provider references and payment status. MGS never stores a PIN, a Mobile Money password or a bank card number."]],
    ["5. Technical data and logs", ["IP address (used for abuse rate limiting and traceability of sensitive actions), timestamps, payment events and audit logs of administrator actions."]],
    ["6. Cookies and local storage", ["A secure httpOnly session cookie keeps you signed in. Browser local storage keeps your cart, your language (FR/EN) and your theme (light/dark). No advertising or third-party tracking cookies are used."]],
    ["7. Notifications", ["If you allow push notifications, a browser subscription identifier is stored so we can inform you about your orders. You can disable them at any time."]],
    ["8. Third-party services", ["Your data is processed by strictly necessary providers: FazerCards (top-up delivery: PUBG Mobile ID and product), PAPI and FiveOne Pay (payment: amount, payer number, reference), Mailjet (transactional emails: address and order content), Render (hosting) and Cloudflare (domain, network security)."]],
    ["9. Retention", ["Order data is kept for accounting, support and fraud prevention. Account data is kept until you delete your account; already fulfilled orders may be kept in anonymised form."]],
    ["10. Security", ["HTTPS encrypted connections, hashed passwords, httpOnly cookie sessions, single-use expiring email tokens, attempt rate limiting, signature verification of payment notifications and an audit log of administrator actions."]],
    ["11. Sharing", ["No sale or rental of data. Sharing is limited to the providers above and to legal obligations."]],
    ["12. Your rights", ["You can review and correct your information in your customer area, request deletion of your account, or contact us for any access or erasure request under applicable Malagasy law."]],
    ["13. Contact", [`Email: ${CONTACT_EMAIL} — WhatsApp: 037 75 198 33 — Phone: 038 39 056 92.`]],
  ],
};

function LegalPage({ title, sections, testid }) {
  const { lang } = useLang();
  return (
    <article className="mx-auto max-w-3xl pb-24 pt-8" data-testid={testid}>
      <h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground" data-testid={`${testid}-updated`}>
        {lang === "en" ? "Last updated" : "Mise à jour"} : {UPDATED[lang] || UPDATED.fr}
      </p>
      <div className="mt-8 space-y-8">
        {sections.map(([heading, paragraphs]) => (
          <section key={heading} className="border-l-2 border-foreground pl-4">
            <h2 className="font-display text-base font-bold md:text-lg">{heading}</h2>
            <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
              {paragraphs.map((p) => <p key={p} className="break-words">{p}</p>)}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

export function Terms() {
  const { lang } = useLang();
  return <LegalPage testid="terms-page" title={lang === "en" ? "Terms of use" : "Conditions d'utilisation"} sections={TERMS[lang] || TERMS.fr} />;
}

export function Privacy() {
  const { lang } = useLang();
  return <LegalPage testid="privacy-page" title={lang === "en" ? "Privacy policy" : "Politique de confidentialité"} sections={PRIVACY[lang] || PRIVACY.fr} />;
}
