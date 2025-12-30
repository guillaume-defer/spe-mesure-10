# SPE Monitor - Surveillance des établissements SPE

Système de surveillance automatique des établissements du périmètre SPE (Services Publics Écoresponsables) dans le Registre national des cantines.

## Fonctionnalités

- 📡 **Récupération complète** : Tous les établissements (~57 000) sont surveillés
- 🔍 **Détection des changements** : Nouveaux, modifiés, supprimés
- 🏛️ **Alertes ministère** : Mise en évidence des rattachements/retraits SPE
- 📧 **Notifications email** : Via Resend (100 emails/jour gratuit)
- 📊 **Filtrage par périmètre** : Ministère ou région
- ⏰ **Exécution automatique** : Tous les jours à 7h00

## Installation

### 1. Créer un compte Resend

1. Inscrivez-vous sur [resend.com](https://resend.com)
2. Créez une clé API dans **API Keys** → **Create API Key**
3. Copiez la clé (commence par `re_...`)

### 2. Configurer GitHub

1. Forkez ou uploadez ce repository sur GitHub
2. Allez dans **Settings** → **Secrets and variables** → **Actions**
3. Créez un secret `RESEND_API_KEY` avec votre clé API

### 3. Configurer les abonnés

Modifiez `config/subscribers.json` :

```json
{
  "abonnes": [
    {
      "email": "votre.email@example.com",
      "nom": "Votre Nom",
      "perimetres": ["ALL"],
      "actif": true
    },
    {
      "email": "referent.justice@example.com",
      "nom": "Référent Justice",
      "perimetres": ["Justice"],
      "actif": true
    },
    {
      "email": "referent.idf@example.com",
      "nom": "Référent Île-de-France",
      "perimetres": ["Île-de-France"],
      "actif": true
    }
  ],
  "parametres": {
    "sender_email": "SPE Monitor <onboarding@resend.dev>",
    "subject_prefix": "[SPE Monitor]"
  }
}
```

### Périmètres disponibles

- `ALL` : Tous les changements
- Ministères : `Agriculture et Alimentation`, `ATE`, `Culture`, `Économie, finances et relance`, `Éducation nationale`, `Enseignement supérieur`, `Justice`, etc.
- Régions : `Île-de-France`, `Auvergne-Rhône-Alpes`, `Nouvelle-Aquitaine`, etc.

## Exécution

### Automatique

Le workflow s'exécute automatiquement tous les jours à 7h00 (heure de Paris).

### Manuelle

1. Allez dans **Actions** → **SPE Monitor**
2. Cliquez sur **Run workflow**
3. Optionnel : Cochez **Mode test** pour ne pas envoyer d'emails

### Locale (test)

```bash
export RESEND_API_KEY="re_votre_cle"
node monitor.js --dry-run
```

## Structure des emails

Les emails contiennent :

- **Résumé** : Nombre de nouveaux, modifiés, supprimés
- **Nouveaux établissements** : Tableau avec nom, SIRET, ville, ministère
- **Établissements modifiés** : Détail des champs modifiés avec ancienne/nouvelle valeur
  - Mise en évidence spéciale pour les changements de ministère (rattachement/retrait SPE)
- **Établissements supprimés** : Liste des établissements retirés

## Fichiers

```
.
├── monitor.js              # Script principal
├── package.json            # Configuration npm
├── config/
│   └── subscribers.json    # Configuration des abonnés
├── data/
│   ├── previous-state.json # État précédent (auto-généré)
│   └── changes-*.json      # Rapports de changements (auto-générés)
└── .github/
    └── workflows/
        └── monitor.yml     # Workflow GitHub Actions
```

## Champs surveillés

- `name` : Nom de l'établissement
- `siret` : Numéro SIRET
- `city`, `department_lib`, `region_lib` : Localisation
- `line_ministry` : Ministère de tutelle (important pour SPE)
- `sector_list` : Secteur d'activité
- `daily_meal_count`, `yearly_meal_count` : Nombre de couverts
- `production_type`, `management_type`, `economic_model` : Caractéristiques
- `active_on_ma_cantine`, `has_active_manager` : Statut sur ma-cantine

## Source des données

[Registre national des cantines](https://www.data.gouv.fr/fr/datasets/registre-national-des-cantines/) sur data.gouv.fr

## Licence

MIT
