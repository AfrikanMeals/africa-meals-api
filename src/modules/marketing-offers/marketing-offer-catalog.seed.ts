/** Auto-generated from docs/MARKETING_OFFER_STRATEGIES.md — do not edit by hand. */

export type MarketingOfferSectionSeed = {
  code: string
  titleFr: string
  titleEn: string
  sortOrder: number
}

export type MarketingOfferSeed = {
  number: number
  sectionCode: string
  type: string
  name: string
  rule: string
  example: string
  phase: string
  priority: string
  complexity: string
}

export const MARKETING_OFFER_SECTION_SEEDS: MarketingOfferSectionSeed[] = [
  { code: "A", titleFr: "Quantité & articles (BOGO family)", titleEn: "Quantity & item promos (BOGO family)", sortOrder: 1 },
  { code: "B", titleFr: "Montant panier (Spend-based)", titleEn: "Spend-based cart promos", sortOrder: 2 },
  { code: "C", titleFr: "Bundles & menus", titleEn: "Bundles & menus", sortOrder: 3 },
  { code: "D", titleFr: "Temporelles & contexte", titleEn: "Time-based & context promos", sortOrder: 4 },
  { code: "E", titleFr: "Client & fidélité", titleEn: "Customer & loyalty promos", sortOrder: 5 },
  { code: "F", titleFr: "Canal & fulfillment", titleEn: "Channel & fulfillment promos", sortOrder: 6 },
  { code: "G", titleFr: "Produit & catégorie", titleEn: "Product & category promos", sortOrder: 7 },
  { code: "H", titleFr: "Paiement & panier technique", titleEn: "Payment & cart technical rules", sortOrder: 8 },
  { code: "I", titleFr: "Gamification & exclusivité", titleEn: "Gamification & exclusivity", sortOrder: 9 },
  { code: "J", titleFr: "Partenariats & B2B", titleEn: "Partnerships & B2B", sortOrder: 10 },
]

export const MARKETING_OFFER_SEEDS: MarketingOfferSeed[] = [
  { number: 1, sectionCode: "A", type: "BOGO_1", name: "BOGO", rule: "2e article identique gratuit", example: "2e poulet DG offert", phase: "P2", priority: "Haute", complexity: "L" },
  { number: 2, sectionCode: "A", type: "BOGO_50_2", name: "BOGO 50 %", rule: "2e article à -50 %", example: "2e boisson -50 %", phase: "P2", priority: "Haute", complexity: "L" },
  { number: 3, sectionCode: "A", type: "BUY_2_GET_1_FREE_3", name: "Buy 2 Get 1 Free", rule: "3 pour le prix de 2", example: "3 beignets, payez 2", phase: "P2", priority: "Haute", complexity: "L" },
  { number: 4, sectionCode: "A", type: "BUY_X_GET_Y_4", name: "Buy X Get Y", rule: "X achetés → Y offerts (SKU configurable)", example: "2 plats → dessert offert", phase: "P2", priority: "Haute", complexity: "L" },
  { number: 5, sectionCode: "A", type: "MIX_MATCH_5", name: "Mix & Match", rule: "N articles d'une liste → remise", example: "3 accompagnements -20 %", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 6, sectionCode: "A", type: "CHEAPEST_FREE_6", name: "Cheapest Free", rule: "N articles → le moins cher offert", example: "3 plats → moins cher offert", phase: "P2", priority: "Moyenne", complexity: "L" },
  { number: 7, sectionCode: "A", type: "TIERED_QUANTITY_7", name: "Tiered quantity", rule: "Remise croissante par quantité", example: "2 plats -5 %, 3 plats -10 %", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 8, sectionCode: "A", type: "SECOND_CATEGORY_FREE_8", name: "Second category free", rule: "Catégorie A → catégorie B offerte", example: "Plat → boisson offerte", phase: "P2", priority: "Haute", complexity: "M" },
  { number: 9, sectionCode: "A", type: "UPSIZE_FREE_9", name: "Upsize free", rule: "Upgrade taille gratuit", example: "M → L gratuit week-end", phase: "P3", priority: "Basse", complexity: "M" },
  { number: 10, sectionCode: "A", type: "ADD_ON_FREE_10", name: "Add-on free", rule: "Complément offert avec plat cible", example: "Sauce offerte", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 11, sectionCode: "B", type: "SPEND_X_GET_Y_OFF_11", name: "Spend X get Y off", rule: "Sous-total ≥ X → -Y fixe", example: "≥ 5 000 XAF → -500 XAF", phase: "P1", priority: "Haute", complexity: "S" },
  { number: 12, sectionCode: "B", type: "SPEND_X_GET_Y_12", name: "Spend X get Y %", rule: "Sous-total ≥ X → -Y %", example: "≥ 30 $ → -15 %", phase: "P1", priority: "Haute", complexity: "S" },
  { number: 13, sectionCode: "B", type: "SPEND_X_GET_COUPON_13", name: "Spend X get coupon", rule: "Seuil → coupon auto (prochaine commande)", example: "≥ 50 $ → code -10 %", phase: "P3", priority: "Haute", complexity: "L" },
  { number: 14, sectionCode: "B", type: "SPEND_X_FREE_DELIVERY_14", name: "Spend X free delivery", rule: "Livraison offerte au seuil", example: "Gratuit dès 25 $", phase: "P1", priority: "Haute", complexity: "M" },
  { number: 15, sectionCode: "B", type: "SPEND_X_FREE_ITEM_15", name: "Spend X free item", rule: "Seuil → SKU gratuit", example: "≥ 40 $ → salade offerte", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 16, sectionCode: "B", type: "PROGRESS_BAR_PALIERS_16", name: "Progress bar / paliers", rule: "Paliers multiples sur même promo", example: "20 $ / 35 $ / 50 $", phase: "P1", priority: "Moyenne", complexity: "M" },
  { number: 17, sectionCode: "B", type: "ALMOST_THERE_NUDGE_17", name: "Almost there nudge", rule: "UX « plus que X » (même moteur)", example: "Bandeau panier", phase: "P1", priority: "Moyenne", complexity: "S" },
  { number: 18, sectionCode: "B", type: "SPEND_PER_STORE_18", name: "Spend per store", rule: "Seuil par boutique (checkout groupé)", example: "Palier par resto", phase: "P1", priority: "Haute", complexity: "M" },
  { number: 19, sectionCode: "C", type: "FIXED_BUNDLE_PRICE_19", name: "Fixed bundle price", rule: "Menu composé prix fixe", example: "Plat + boisson = 12 $", phase: "P2", priority: "Haute", complexity: "M" },
  { number: 20, sectionCode: "C", type: "PICK_N_FOR_PRICE_20", name: "Pick N for price", rule: "N articles au choix → prix fixe", example: "2 plats = 18 $", phase: "P2", priority: "Haute", complexity: "M" },
  { number: 21, sectionCode: "C", type: "FAMILY_PACK_21", name: "Family pack", rule: "Bundle multi-portions", example: "Pack 4 personnes", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 22, sectionCode: "C", type: "MEAL_DEAL_TIME_SLOT_22", name: "Meal deal time slot", rule: "Bundle créneau horaire", example: "Menu déjeuner 11h–14h", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 23, sectionCode: "C", type: "COMBO_UPGRADE_23", name: "Combo upgrade", rule: "Surcoût bundle réduit", example: "Dessert premium +2 $", phase: "P3", priority: "Basse", complexity: "M" },
  { number: 24, sectionCode: "D", type: "HAPPY_HOUR_24", name: "Happy hour", rule: "-X % heures creuses", example: "-20 % 14h–16h", phase: "P1", priority: "Haute", complexity: "M" },
  { number: 25, sectionCode: "D", type: "JOUR_DE_LA_SEMAINE_25", name: "Jour de la semaine", rule: "Promo récurrente", example: "Mardi -10 %", phase: "P1", priority: "Moyenne", complexity: "M" },
  { number: 26, sectionCode: "D", type: "FLASH_SALE_26", name: "Flash sale", rule: "Fenêtre courte", example: "-30 % 1 h", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 27, sectionCode: "D", type: "EARLY_BIRD_PRE_ORDER_27", name: "Early bird pre-order", rule: "Réduction pré-commande anticipée", example: "-5 % J+3", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 28, sectionCode: "D", type: "LATE_NIGHT_28", name: "Late night", rule: "Promo nocturne", example: "-15 % après 21h", phase: "P2", priority: "Basse", complexity: "M" },
  { number: 29, sectionCode: "D", type: "RAINY_DAY_WEATHER_29", name: "Rainy day / weather", rule: "Déclencheur météo", example: "Livraison offerte si pluie", phase: "P4", priority: "Basse", complexity: "XL" },
  { number: 30, sectionCode: "D", type: "FIRST_N_ORDERS_30", name: "First N orders", rule: "N premiers clients / jour", example: "20 premiers : dessert", phase: "P3", priority: "Basse", complexity: "M" },
  { number: 31, sectionCode: "E", type: "FIRST_ORDER_31", name: "First order", rule: "1re commande boutique / plateforme", example: "-20 % 1re commande", phase: "P1", priority: "Haute", complexity: "M" },
  { number: 32, sectionCode: "E", type: "WELCOME_BACK_32", name: "Welcome back", rule: "Retour après inactivité", example: "-10 % après 30 j", phase: "P3", priority: "Moyenne", complexity: "M" },
  { number: 33, sectionCode: "E", type: "BIRTHDAY_33", name: "Birthday", rule: "Semaine anniversaire", example: "Plat offert", phase: "P3", priority: "Moyenne", complexity: "M" },
  { number: 34, sectionCode: "E", type: "REFERRAL_34", name: "Referral", rule: "Parrain + filleul", example: "-10 $ chacun", phase: "P4", priority: "Haute", complexity: "XL" },
  { number: 35, sectionCode: "E", type: "VIP_TIER_AUTO_35", name: "VIP tier auto", rule: "Palier fidélité → remise auto", example: "Gold -10 %", phase: "P3", priority: "Haute", complexity: "L" },
  { number: 36, sectionCode: "E", type: "POINTS_MULTIPLIER_36", name: "Points multiplier", rule: "2× points période", example: "Double points WE", phase: "P3", priority: "Basse", complexity: "M" },
  { number: 37, sectionCode: "E", type: "STAMP_CARD_37", name: "Stamp card", rule: "N commandes → 1 offerte", example: "9 → 10e offerte", phase: "P3", priority: "Haute", complexity: "L" },
  { number: 38, sectionCode: "E", type: "SUBSCRIPTION_PASS_38", name: "Subscription / pass", rule: "Abonnement mensuel", example: "Pass livraison", phase: "P4", priority: "Basse", complexity: "XL" },
  { number: 39, sectionCode: "F", type: "PICKUP_DISCOUNT_39", name: "Pickup discount", rule: "Remise retrait vs livraison", example: "-5 % retrait", phase: "P1", priority: "Haute", complexity: "S" },
  { number: 40, sectionCode: "F", type: "DELIVERY_ONLY_PROMO_40", name: "Delivery-only promo", rule: "Promo livraison uniquement", example: "2e plat -50 % livraison", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 41, sectionCode: "F", type: "PRE_ORDER_EXCLUSIVE_41", name: "Pre-order exclusive", rule: "Promo pré-commande date future", example: "-8 % pré-commande", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 42, sectionCode: "F", type: "APP_ONLY_42", name: "App-only", rule: "Réservé application mobile", example: "-5 % app", phase: "P3", priority: "Basse", complexity: "M" },
  { number: 43, sectionCode: "F", type: "PAY_NOW_VS_DEFER_43", name: "Pay now vs defer", rule: "Remise paiement immédiat pré-commande", example: "-3 % Pay Now", phase: "P3", priority: "Basse", complexity: "M" },
  { number: 44, sectionCode: "G", type: "CATEGORY_OFF_44", name: "Category % off", rule: "-X % sur catégorie", example: "-15 % boissons", phase: "P1", priority: "Haute", complexity: "M" },
  { number: 45, sectionCode: "G", type: "BUY_A_B_OFF_45", name: "Buy A → B off", rule: "Cross-category", example: "Plat → boisson locale offerte", phase: "P2", priority: "Haute", complexity: "M" },
  { number: 46, sectionCode: "G", type: "NEW_DISH_LAUNCH_46", name: "New dish launch", rule: "Promo SKU nouveau", example: "-20 % 1re semaine", phase: "P2", priority: "Moyenne", complexity: "S" },
  { number: 47, sectionCode: "G", type: "CLEARANCE_SURPLUS_47", name: "Clearance / surplus", rule: "Invendus fin service", example: "-40 %", phase: "P3", priority: "Basse", complexity: "M" },
  { number: 48, sectionCode: "G", type: "VENDOR_SPOTLIGHT_48", name: "Vendor spotlight", rule: "Admin met en avant 1 resto", example: "Resto du mois -10 %", phase: "P3", priority: "Moyenne", complexity: "M" },
  { number: 49, sectionCode: "G", type: "MIN_ITEMS_FROM_LIST_49", name: "Min items from list", rule: "≥ N plats « signature »", example: "2 plats chef → -12 %", phase: "P2", priority: "Moyenne", complexity: "M" },
  { number: 50, sectionCode: "H", type: "WALLET_GIFT_BALANCE_BONUS_50", name: "Wallet / gift balance bonus", rule: "Bonus si solde utilisé", example: "+5 % crédit", phase: "P4", priority: "Basse", complexity: "L" },
  { number: 51, sectionCode: "H", type: "STACKING_POLICY_51", name: "Stacking policy", rule: "Priorité promo auto vs coupon manuel", example: "Non cumulable", phase: "P0", priority: "Haute", complexity: "M" },
  { number: 52, sectionCode: "H", type: "CAP_MAX_DISCOUNT_52", name: "Cap max discount", rule: "Plafond remise par commande", example: "Max -25 $", phase: "P1", priority: "Haute", complexity: "S" },
  { number: 53, sectionCode: "H", type: "SUBTOTAL_BEFORE_FEES_53", name: "Subtotal before fees", rule: "Base = produits hors livraison/taxes", example: "Standard", phase: "P0", priority: "Haute", complexity: "S" },
  { number: 54, sectionCode: "H", type: "MULTI_STORE_SPLIT_54", name: "Multi-store split", rule: "Allocation remise checkout groupé", example: "Par boutique", phase: "P1", priority: "Haute", complexity: "M" },
  { number: 55, sectionCode: "I", type: "SECRET_MENU_CODE_55", name: "Secret menu code", rule: "Code caché réseaux", example: "INSTA15", phase: "P3", priority: "Moyenne", complexity: "S" },
  { number: 56, sectionCode: "I", type: "SPIN_WHEEL_56", name: "Spin wheel", rule: "Roue post-commande → coupon", example: "Jeu concours", phase: "P4", priority: "Basse", complexity: "XL" },
  { number: 57, sectionCode: "I", type: "CHALLENGE_57", name: "Challenge", rule: "Défi hebdo → badge + offre", example: "3 cmd / semaine", phase: "P4", priority: "Basse", complexity: "XL" },
  { number: 58, sectionCode: "I", type: "LIMITED_SEATS_58", name: "Limited seats", rule: "Quota restant affiché", example: "« Plus que 12 »", phase: "P2", priority: "Moyenne", complexity: "S" },
  { number: 59, sectionCode: "I", type: "GEO_FENCE_59", name: "Geo-fence", rule: "Promo zone / campus", example: "-10 % campus", phase: "P4", priority: "Basse", complexity: "XL" },
  { number: 60, sectionCode: "I", type: "GROUP_ORDER_60", name: "Group order", rule: "Même adresse, N personnes", example: "4+ → -8 %", phase: "P4", priority: "Basse", complexity: "XL" },
  { number: 61, sectionCode: "J", type: "EMPLOYER_CODE_61", name: "Employer code", rule: "Code entreprise", example: "WISECORP -12 %", phase: "P3", priority: "Moyenne", complexity: "M" },
  { number: 62, sectionCode: "J", type: "BANK_TELCO_62", name: "Bank / telco", rule: "Partenariat opérateur", example: "ORANGE10", phase: "P3", priority: "Moyenne", complexity: "M" },
  { number: 63, sectionCode: "J", type: "INFLUENCER_CODE_63", name: "Influencer code", rule: "Tracking affilié", example: "CHEF123", phase: "P3", priority: "Moyenne", complexity: "M" },
  { number: 64, sectionCode: "J", type: "CASHBACK_64", name: "Cashback", rule: "Crédit post-commande", example: "5 % wallet", phase: "P3", priority: "Moyenne", complexity: "L" },
  { number: 65, sectionCode: "J", type: "CHARITY_MATCH_65", name: "Charity match", rule: "Reversement association", example: "1 $ / commande", phase: "P4", priority: "Basse", complexity: "L" },
]
