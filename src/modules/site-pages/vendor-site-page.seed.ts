import type { VendorSitePageContent } from './site-page-content.types';

/** Seed FR/EN aligné sur public/js/i18n.js → vendor (copy marketing /vendor). */

const TOOLS_IMAGE = '/image/2151336563.jpg';

function vendorFr(): VendorSitePageContent {
  return {
    hero: {
      badge: 'Pour les restaurants',
      h1: 'Devenez restaurant partenaire',
      lead: 'Publiez votre menu, recevez les commandes en temps réel et touchez une clientèle passionnée — avec un espace admin pensé pour vous.',
      btnAdmin: 'Ouvrir l’espace admin',
      btnPricing: 'Voir les plans',
    },
    pills: {
      why: 'Pourquoi Wise Eat',
      tools: 'Outils admin',
      steps: 'Inscription',
      pricing: 'Tarifs',
      faq: 'FAQ',
    },
    highlights: [
      {
        title: 'Commandes en temps réel',
        text: 'Recevez chaque commande instantanément dans votre espace admin, avec notifications et suivi de statut.',
        link: 'Découvrir les outils →',
      },
      {
        title: 'Menu & promotions',
        text: 'Gérez plats, prix, disponibilités et codes promo depuis un tableau de bord intuitif.',
        link: 'Fonctionnalités →',
      },
      {
        title: 'Démarrez au Canada',
        text: 'Plan FREE pour tester, essais gratuits sur les plans payants et paiements sécurisés via Stripe Connect.',
        link: 'Plans & commission →',
      },
    ],
    why: {
      title: 'Pourquoi rejoindre Wise Eat ?',
      lead: 'Une plateforme conçue pour les restaurateurs qui veulent digitaliser leur activité sans complexité.',
      perks: [
        {
          title: 'Technologie moderne',
          text: 'Interface admin claire et application mobile performante pour vos clients et livreurs.',
        },
        {
          title: 'Temps réel',
          text: 'Commandes, notifications et suivi GPS synchronisés instantanément.',
        },
        {
          title: 'Visibilité',
          text: 'Touchez une clientèle passionnée de gastronomie africaine et internationale au Canada.',
        },
        {
          title: 'Support humain',
          text: 'Une équipe disponible pour vous accompagner à l’inscription et au quotidien.',
        },
        {
          title: 'Croissance',
          text: 'Statistiques, rapports et outils marketing pour développer votre chiffre d’affaires.',
        },
      ],
    },
    tools: {
      title: 'Votre espace admin',
      lead: 'Tout ce dont vous avez besoin pour gérer votre restaurant en ligne, depuis un seul portail.',
      imageUrl: TOOLS_IMAGE,
      imageAlt: 'Espace admin Wise Eat pour restaurants partenaires',
      items: [
        {
          title: 'Catalogue & menu',
          text: 'Plats, catégories, options, prix et photos — mis à jour en quelques clics.',
        },
        {
          title: 'Gestion des commandes',
          text: 'Réception, préparation, remise au livreur et historique complet.',
        },
        {
          title: 'Marketing & promos',
          text: 'Créez des codes promo, campagnes et offres pour fidéliser votre clientèle.',
        },
        {
          title: 'Rapports & analytics',
          text: 'Suivez vos ventes, vos heures de pointe et l’évolution de votre activité.',
        },
        {
          title: 'Paiements Stripe Connect',
          text: 'Encaissement sécurisé et virements vers votre compte bancaire.',
        },
        {
          title: 'Horaires & disponibilités',
          text: 'Horaires d’ouverture, pause temporaire et statut en ligne — à jour en temps réel.',
        },
        {
          title: 'Livraisons & zone',
          text: 'Paramétrez votre zone de couverture et suivez les remises aux livreurs.',
        },
      ],
    },
    steps: {
      title: 'Comment s’inscrire ?',
      lead: 'Quatre étapes pour lancer votre restaurant sur Wise Eat.',
      items: [
        {
          title: 'Créez votre compte',
          text: 'Inscrivez-vous sur l’espace admin Wise Eat et renseignez les informations de votre établissement.',
        },
        {
          title: 'Configurez votre boutique',
          text: 'Ajoutez votre menu, vos horaires, votre zone de livraison et vos paramètres de paiement.',
        },
        {
          title: 'Validation Wise Eat',
          text: 'Notre équipe vérifie votre dossier avant la mise en ligne sur l’application mobile.',
        },
        {
          title: 'Recevez vos commandes',
          text: 'Votre restaurant apparaît dans l’app : vous gérez les commandes en temps réel depuis l’admin.',
        },
      ],
    },
    pricingCopy: {
      title: 'Plans & commission',
      lead: 'Choisissez l’abonnement adapté à votre restaurant. Démarrez gratuitement, évoluez quand vous êtes prêt.',
      commissionTitle: 'Commission par commande',
      commissionText:
        'En plus de l’abonnement, une commission plateforme s’applique sur le montant articles : ',
      link: 'Voir le détail complet des tarifs et frais plateforme →',
      feesRateFree: 'Gratuit',
      feesNoteEstimated:
        'Les tarifs marqués * sont indicatifs lorsque la configuration admin est encore à zéro.',
    },
    faq: {
      title: 'Questions fréquentes',
      lead: 'Tout ce qu’il faut savoir avant de rejoindre Wise Eat en tant que restaurant.',
      items: [
        {
          q: 'Puis-je commencer gratuitement ?',
          a: 'Oui. Le plan FREE permet de recevoir des commandes et de gérer un catalogue limité sans frais d’abonnement mensuel.',
        },
        {
          q: 'Combien de temps prend la validation ?',
          a: 'Après soumission de votre dossier (menu, horaires, paiements), notre équipe vérifie votre profil avant publication. Les délais varient selon la complétude du dossier.',
        },
        {
          q: 'Comment sont gérés les paiements ?',
          a: 'Les clients paient dans l’app. Wise Eat utilise Stripe Connect pour sécuriser les encaissements et reverser votre part après commission plateforme.',
        },
        {
          q: 'Puis-je créer mes propres codes promo ?',
          a: 'Oui, depuis l’espace admin (Marketing). Vos clients les saisissent au checkout mobile. Voir aussi la page <a href="/promo">Récompenses & promos</a>.',
          html: true,
        },
        {
          q: 'Et si je veux livrer moi-même ?',
          a: 'Wise Eat propose la livraison via des agents partenaires. Les zones et frais client sont détaillés sur la page <a href="/delivery">Livraison & zones</a>.',
          html: true,
        },
      ],
    },
    cta: {
      title: 'Prêt à rejoindre Wise Eat ?',
      lead: 'Créez votre compte restaurant en quelques minutes et commencez à recevoir des commandes.',
      btnAdmin: 'Ouvrir l’espace admin',
      btnContact: 'Nous contacter',
      disclaimer:
        'Offre soumise à validation. Wise Eat se réserve le droit d’accepter ou refuser une candidature restaurant. Voir les CGU pour plus de détails.',
    },
  };
}

function vendorEn(): VendorSitePageContent {
  return {
    hero: {
      badge: 'For restaurants',
      h1: 'Become a partner restaurant',
      lead: 'Publish your menu, receive orders in real time and reach passionate customers — with an admin portal built for you.',
      btnAdmin: 'Open admin portal',
      btnPricing: 'View plans',
    },
    pills: {
      why: 'Why Wise Eat',
      tools: 'Admin tools',
      steps: 'Sign up',
      pricing: 'Pricing',
      faq: 'FAQ',
    },
    highlights: [
      {
        title: 'Real-time orders',
        text: 'Receive every order instantly in your admin portal, with notifications and status tracking.',
        link: 'Explore tools →',
      },
      {
        title: 'Menu & promotions',
        text: 'Manage dishes, prices, availability and promo codes from an intuitive dashboard.',
        link: 'Features →',
      },
      {
        title: 'Start in Canada',
        text: 'FREE plan to try, free trials on paid plans and secure payments via Stripe Connect.',
        link: 'Plans & commission →',
      },
    ],
    why: {
      title: 'Why join Wise Eat?',
      lead: 'A platform built for restaurateurs who want to go digital without the complexity.',
      perks: [
        {
          title: 'Modern technology',
          text: 'Clear admin interface and a high-performance mobile app for customers and couriers.',
        },
        {
          title: 'Real time',
          text: 'Orders, notifications and GPS tracking synced instantly.',
        },
        {
          title: 'Visibility',
          text: 'Reach customers passionate about African and international cuisine in Canada.',
        },
        {
          title: 'Human support',
          text: 'A team available to help you onboard and day to day.',
        },
        {
          title: 'Growth',
          text: 'Stats, reports and marketing tools to grow your revenue.',
        },
      ],
    },
    tools: {
      title: 'Your admin portal',
      lead: 'Everything you need to run your restaurant online, from a single portal.',
      imageUrl: TOOLS_IMAGE,
      imageAlt: 'Wise Eat admin portal for partner restaurants',
      items: [
        {
          title: 'Catalog & menu',
          text: 'Dishes, categories, options, prices and photos — updated in a few clicks.',
        },
        {
          title: 'Order management',
          text: 'Receive, prepare, hand off to courier and full order history.',
        },
        {
          title: 'Marketing & promos',
          text: 'Create promo codes, campaigns and offers to retain your customers.',
        },
        {
          title: 'Reports & analytics',
          text: 'Track sales, peak hours and how your business evolves.',
        },
        {
          title: 'Stripe Connect payments',
          text: 'Secure checkout and payouts to your bank account.',
        },
        {
          title: 'Hours & availability',
          text: 'Opening hours, temporary pause and online status — updated in real time.',
        },
        {
          title: 'Delivery & coverage zone',
          text: 'Configure your delivery area and track handoffs to couriers.',
        },
      ],
    },
    steps: {
      title: 'How to sign up',
      lead: 'Four steps to launch your restaurant on Wise Eat.',
      items: [
        {
          title: 'Create your account',
          text: 'Sign up on the Wise Eat admin portal and enter your establishment details.',
        },
        {
          title: 'Set up your store',
          text: 'Add your menu, hours, delivery zone and payment settings.',
        },
        {
          title: 'Wise Eat review',
          text: 'Our team verifies your application before going live on the mobile app.',
        },
        {
          title: 'Receive orders',
          text: 'Your restaurant appears in the app — manage orders in real time from admin.',
        },
      ],
    },
    pricingCopy: {
      title: 'Plans & commission',
      lead: 'Pick the subscription that fits your restaurant. Start free, upgrade when ready.',
      commissionTitle: 'Per-order commission',
      commissionText:
        'In addition to subscription, a platform commission applies to item subtotal: ',
      link: 'See full pricing and platform fees →',
      feesRateFree: 'Free',
      feesNoteEstimated:
        'Rates marked with * are indicative when the admin configuration is still at zero.',
    },
    faq: {
      title: 'Frequently asked questions',
      lead: 'Everything you need to know before joining Wise Eat as a restaurant.',
      items: [
        {
          q: 'Can I start for free?',
          a: 'Yes. The FREE plan lets you receive orders and manage a limited catalog with no monthly subscription fee.',
        },
        {
          q: 'How long does approval take?',
          a: 'After you submit your application (menu, hours, payments), our team reviews your profile before publication. Timing depends on completeness.',
        },
        {
          q: 'How are payments handled?',
          a: 'Customers pay in the app. Wise Eat uses Stripe Connect to secure payments and transfer your share after platform commission.',
        },
        {
          q: 'Can I create my own promo codes?',
          a: 'Yes, from the admin portal (Marketing). Customers enter them at mobile checkout. See also <a href="/promo">Rewards & promos</a>.',
          html: true,
        },
        {
          q: 'What if I want to deliver myself?',
          a: 'Wise Eat offers delivery through partner couriers. Customer zones and fees are on the <a href="/delivery">Delivery & zones</a> page.',
          html: true,
        },
      ],
    },
    cta: {
      title: 'Ready to join Wise Eat?',
      lead: 'Create your restaurant account in minutes and start receiving orders.',
      btnAdmin: 'Open admin portal',
      btnContact: 'Contact us',
      disclaimer:
        'Subject to approval. Wise Eat may accept or decline restaurant applications. See Terms of Use for details.',
    },
  };
}

export type VendorSitePageSeed = {
  slug: 'vendor';
  locale: 'fr' | 'en';
  title: string;
  metaTitle: string;
  metaDescription: string;
  content: VendorSitePageContent;
  isPublished: boolean;
};

/** Seeds initiaux — upsert uniquement si le doc (slug, locale) n’existe pas. */
export function vendorSitePageSeeds(): VendorSitePageSeed[] {
  const fr = vendorFr();
  const en = vendorEn();
  return [
    {
      slug: 'vendor',
      locale: 'fr',
      title: 'Restaurant partenaire',
      metaTitle: 'Restaurant partenaire — Wise Eat',
      metaDescription:
        'Rejoignez Wise Eat en tant que restaurant partenaire : espace admin, commandes en temps réel, abonnements et commission transparente au Canada.',
      content: fr,
      isPublished: true,
    },
    {
      slug: 'vendor',
      locale: 'en',
      title: 'Partner restaurant',
      metaTitle: 'Partner restaurant — Wise Eat',
      metaDescription:
        'Join Wise Eat as a partner restaurant: admin portal, real-time orders, subscriptions and transparent commission in Canada.',
      content: en,
      isPublished: true,
    },
  ];
}
