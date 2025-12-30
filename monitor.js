/**
 * SPE Monitor - Surveillance des établissements SPE
 * 
 * Ce script :
 * 1. Récupère les données actuelles depuis l'API data.gouv.fr
 * 2. Compare avec les données précédentes
 * 3. Détecte les changements (nouveaux, modifiés, supprimés)
 * 4. Envoie des alertes par email via Resend
 * 5. Sauvegarde le nouvel état
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const API_BASE = 'https://tabular-api.data.gouv.fr/api/resources';
const RESOURCE_ID = '408dca92-9028-4f66-93bf-f671111393ec'; // Registre national des cantines
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_DIR = path.join(__dirname, 'config');

// Limite de pages (1500 pages × 50 = 75 000 établissements max)
const MAX_PAGES = 1500;

// Champs à surveiller pour détecter les modifications
const MONITORED_FIELDS = [
  'name', 'siret', 'city', 'department_lib', 'region_lib',
  'line_ministry', 'sector_list', 'daily_meal_count', 'yearly_meal_count',
  'production_type', 'management_type', 'economic_model',
  'active_on_ma_cantine', 'has_active_manager'
];

// Labels français pour les champs
const FIELD_LABELS = {
  name: 'Nom',
  siret: 'SIRET',
  city: 'Ville',
  department_lib: 'Département',
  region_lib: 'Région',
  line_ministry: 'Ministère de tutelle',
  sector_list: 'Secteur',
  daily_meal_count: 'Couverts/jour',
  yearly_meal_count: 'Couverts/an',
  production_type: 'Type de production',
  management_type: 'Type de gestion',
  economic_model: 'Modèle économique',
  active_on_ma_cantine: 'Actif sur ma-cantine',
  has_active_manager: 'Gestionnaire actif'
};

/**
 * Récupère toutes les données depuis l'API avec pagination
 */
async function fetchAllData() {
  console.log('📡 Récupération des données depuis l\'API...');
  
  let allData = [];
  let currentPage = 1;
  let hasMore = true;
  let total = 0;
  
  while (hasMore) {
    const url = `${API_BASE}/${RESOURCE_ID}/data/?page=${currentPage}&page_size=50`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      const pageData = result.data || [];
      total = result.meta?.total || 0;
      
      allData = [...allData, ...pageData];
      hasMore = allData.length < total && pageData.length > 0;
      
      // Affichage progression tous les 100 pages
      if (currentPage % 100 === 0 || !hasMore) {
        console.log(`   Page ${currentPage}: ${allData.length}/${total} établissements`);
      }
      
      currentPage++;
      
      // Pause pour éviter le rate limiting
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Limite de sécurité
      if (currentPage > MAX_PAGES) {
        console.warn(`⚠️ Limite de ${MAX_PAGES} pages atteinte`);
        break;
      }
    } catch (error) {
      console.error(`❌ Erreur page ${currentPage}:`, error.message);
      // Retry une fois après 2 secondes
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const response = await fetch(url);
        if (response.ok) {
          const result = await response.json();
          const pageData = result.data || [];
          allData = [...allData, ...pageData];
          currentPage++;
          continue;
        }
      } catch (retryError) {
        console.error(`❌ Échec retry page ${currentPage}:`, retryError.message);
      }
      break;
    }
  }
  
  console.log(`✅ ${allData.length}/${total} établissements récupérés`);
  return allData;
}

/**
 * Charge les données précédentes depuis le fichier JSON
 */
function loadPreviousData() {
  const filePath = path.join(DATA_DIR, 'previous-state.json');
  
  if (!fs.existsSync(filePath)) {
    console.log('📂 Pas de données précédentes (première exécution)');
    return {};
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`📂 ${Object.keys(data).length} établissements chargés depuis l'état précédent`);
    return data;
  } catch (error) {
    console.error('❌ Erreur lecture données précédentes:', error.message);
    return {};
  }
}

/**
 * Sauvegarde l'état actuel
 */
function saveCurrentState(data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  // Indexer par ID pour faciliter la comparaison
  const indexed = {};
  data.forEach(item => {
    if (item.id) {
      indexed[item.id] = item;
    }
  });
  
  const filePath = path.join(DATA_DIR, 'previous-state.json');
  fs.writeFileSync(filePath, JSON.stringify(indexed, null, 2));
  console.log(`💾 État sauvegardé: ${Object.keys(indexed).length} établissements`);
  
  return indexed;
}

/**
 * Compare deux états et retourne les différences
 */
function detectChanges(previousState, currentData) {
  const changes = {
    nouveaux: [],
    modifies: [],
    supprimes: [],
    timestamp: new Date().toISOString()
  };
  
  const currentIndexed = {};
  
  // Détecter les nouveaux et modifiés
  currentData.forEach(item => {
    if (!item.id) return;
    
    currentIndexed[item.id] = item;
    const previous = previousState[item.id];
    
    if (!previous) {
      // Nouvel établissement
      changes.nouveaux.push({
        id: item.id,
        etablissement: item,
        ministere: item.line_ministry,
        region: item.region_lib
      });
    } else {
      // Vérifier les modifications
      const modifications = [];
      
      MONITORED_FIELDS.forEach(field => {
        const oldValue = previous[field];
        const newValue = item[field];
        
        // Normaliser pour comparaison
        const oldNorm = oldValue === null || oldValue === undefined ? '' : String(oldValue);
        const newNorm = newValue === null || newValue === undefined ? '' : String(newValue);
        
        if (oldNorm !== newNorm) {
          modifications.push({
            champ: field,
            label: FIELD_LABELS[field] || field,
            ancienne_valeur: oldValue,
            nouvelle_valeur: newValue
          });
        }
      });
      
      if (modifications.length > 0) {
        changes.modifies.push({
          id: item.id,
          etablissement: item,
          ministere: item.line_ministry,
          region: item.region_lib,
          ancienMinistere: previous.line_ministry,
          modifications
        });
      }
    }
  });
  
  // Détecter les supprimés
  Object.keys(previousState).forEach(id => {
    if (!currentIndexed[id]) {
      const item = previousState[id];
      changes.supprimes.push({
        id,
        etablissement: item,
        ministere: item.line_ministry,
        region: item.region_lib
      });
    }
  });
  
  return changes;
}

/**
 * Charge la configuration des abonnés
 */
function loadSubscribers() {
  const filePath = path.join(CONFIG_DIR, 'subscribers.json');
  
  if (!fs.existsSync(filePath)) {
    console.warn('⚠️ Fichier subscribers.json non trouvé');
    return { abonnes: [], parametres: {} };
  }
  
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Filtre les changements selon le périmètre d'un abonné
 */
function filterChangesForSubscriber(changes, perimetres) {
  if (perimetres.includes('ALL')) {
    return changes;
  }
  
  const filterItem = (item) => {
    // Vérifie le ministère actuel
    if (perimetres.includes(item.ministere)) return true;
    // Vérifie la région
    if (perimetres.includes(item.region)) return true;
    // Pour les modifiés, vérifie aussi l'ancien ministère (cas d'un retrait)
    if (item.ancienMinistere && perimetres.includes(item.ancienMinistere)) return true;
    return false;
  };
  
  return {
    nouveaux: changes.nouveaux.filter(filterItem),
    modifies: changes.modifies.filter(filterItem),
    supprimes: changes.supprimes.filter(filterItem),
    timestamp: changes.timestamp
  };
}

/**
 * Génère le contenu HTML de l'email
 */
function generateEmailHTML(changes, subscriberName) {
  const totalChanges = changes.nouveaux.length + changes.modifies.length + changes.supprimes.length;
  const date = new Date().toLocaleDateString('fr-FR', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  let html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #000091; border-bottom: 3px solid #000091; padding-bottom: 10px; }
    h2 { color: #000091; margin-top: 30px; }
    h3 { color: #666; margin-top: 20px; }
    .summary { background: #f5f5fe; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .summary-item { display: inline-block; margin-right: 30px; }
    .summary-number { font-size: 24px; font-weight: bold; }
    .new { color: #18753c; }
    .modified { color: #b34000; }
    .deleted { color: #ce0500; }
    .ministry-change { background: #fff3cd; padding: 5px 10px; border-radius: 3px; margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .change-detail { margin: 5px 0; padding: 5px; background: #f9f9f9; }
    .old-value { color: #ce0500; text-decoration: line-through; }
    .new-value { color: #18753c; font-weight: bold; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 0.9em; color: #666; }
  </style>
</head>
<body>
  <h1>🔔 Alerte SPE - Changements détectés</h1>
  <p>Bonjour ${subscriberName},</p>
  <p>Des changements ont été détectés dans le Registre national des cantines le <strong>${date}</strong>.</p>
  
  <div class="summary">
    <div class="summary-item">
      <span class="summary-number new">${changes.nouveaux.length}</span><br>
      <span>Nouveau(x)</span>
    </div>
    <div class="summary-item">
      <span class="summary-number modified">${changes.modifies.length}</span><br>
      <span>Modifié(s)</span>
    </div>
    <div class="summary-item">
      <span class="summary-number deleted">${changes.supprimes.length}</span><br>
      <span>Supprimé(s)</span>
    </div>
  </div>
`;

  // Nouveaux établissements
  if (changes.nouveaux.length > 0) {
    html += `
  <h2 class="new">✅ Nouveaux établissements (${changes.nouveaux.length})</h2>
  <table>
    <thead>
      <tr>
        <th>Nom</th>
        <th>SIRET</th>
        <th>Ville</th>
        <th>Ministère</th>
        <th>Secteur</th>
      </tr>
    </thead>
    <tbody>
`;
    changes.nouveaux.forEach(item => {
      const e = item.etablissement;
      html += `
      <tr>
        <td><strong>${e.name || '-'}</strong></td>
        <td>${e.siret || '-'}</td>
        <td>${e.city || '-'}</td>
        <td>${e.line_ministry || '-'}</td>
        <td>${e.sector_list || '-'}</td>
      </tr>
`;
    });
    html += `
    </tbody>
  </table>
`;
  }

  // Établissements modifiés
  if (changes.modifies.length > 0) {
    html += `
  <h2 class="modified">📝 Établissements modifiés (${changes.modifies.length})</h2>
`;
    changes.modifies.forEach(item => {
      const e = item.etablissement;
      
      // Détecter si c'est un changement de ministère
      const ministryChange = item.modifications.find(m => m.champ === 'line_ministry');
      
      html += `
  <h3>${e.name || 'Sans nom'} (${e.siret || 'Sans SIRET'})</h3>
  <p><em>${e.city || ''} - ${e.region_lib || ''}</em></p>
`;
      
      // Mettre en évidence les changements de ministère
      if (ministryChange) {
        const oldMinistry = ministryChange.ancienne_valeur || '(aucun)';
        const newMinistry = ministryChange.nouvelle_valeur || '(aucun)';
        
        if (!ministryChange.ancienne_valeur && ministryChange.nouvelle_valeur) {
          html += `<div class="ministry-change">🏛️ <strong>RATTACHEMENT SPE:</strong> Nouvel établissement rattaché à <strong>${newMinistry}</strong></div>`;
        } else if (ministryChange.ancienne_valeur && !ministryChange.nouvelle_valeur) {
          html += `<div class="ministry-change">⚠️ <strong>RETRAIT SPE:</strong> Établissement retiré du périmètre (était: ${oldMinistry})</div>`;
        } else {
          html += `<div class="ministry-change">🔄 <strong>CHANGEMENT MINISTÈRE:</strong> ${oldMinistry} → ${newMinistry}</div>`;
        }
      }
      
      item.modifications.forEach(mod => {
        if (mod.champ === 'line_ministry') return; // Déjà affiché au-dessus
        html += `
  <div class="change-detail">
    <strong>${mod.label}:</strong> 
    <span class="old-value">${mod.ancienne_valeur || '(vide)'}</span> 
    → 
    <span class="new-value">${mod.nouvelle_valeur || '(vide)'}</span>
  </div>
`;
      });
    });
  }

  // Établissements supprimés
  if (changes.supprimes.length > 0) {
    html += `
  <h2 class="deleted">❌ Établissements supprimés (${changes.supprimes.length})</h2>
  <table>
    <thead>
      <tr>
        <th>Nom</th>
        <th>SIRET</th>
        <th>Ville</th>
        <th>Ministère</th>
      </tr>
    </thead>
    <tbody>
`;
    changes.supprimes.forEach(item => {
      const e = item.etablissement;
      html += `
      <tr>
        <td>${e.name || '-'}</td>
        <td>${e.siret || '-'}</td>
        <td>${e.city || '-'}</td>
        <td>${e.line_ministry || '-'}</td>
      </tr>
`;
    });
    html += `
    </tbody>
  </table>
`;
  }

  html += `
  <div class="footer">
    <p>Ce message est généré automatiquement par le système de surveillance SPE.</p>
    <p>Pour modifier vos préférences d'alerte, contactez l'administrateur.</p>
    <p>Source des données: <a href="https://data.gouv.fr/fr/datasets/registre-national-des-cantines/">Registre national des cantines (data.gouv.fr)</a></p>
  </div>
</body>
</html>
`;

  return html;
}

/**
 * Envoie un email via Resend
 */
async function sendEmailResend(to, toName, subject, htmlContent, config) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  
  if (!RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY non définie');
    return false;
  }
  
  const payload = {
    from: config.sender_email || 'SPE Monitor <onboarding@resend.dev>',
    to: [to],
    subject: subject,
    html: htmlContent
  };
  
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error(`❌ Erreur Resend pour ${to}:`, result);
      return false;
    }
    
    console.log(`✉️ Email envoyé à ${to} (id: ${result.id})`);
    return true;
  } catch (error) {
    console.error(`❌ Erreur envoi email à ${to}:`, error.message);
    return false;
  }
}

/**
 * Sauvegarde le rapport des changements
 */
function saveChangesReport(changes) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  const date = new Date().toISOString().split('T')[0];
  const filePath = path.join(DATA_DIR, `changes-${date}.json`);
  
  fs.writeFileSync(filePath, JSON.stringify(changes, null, 2));
  console.log(`📋 Rapport sauvegardé: ${filePath}`);
}

/**
 * Fonction principale
 */
async function main() {
  console.log('🚀 Démarrage du monitoring SPE');
  console.log('================================\n');
  
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('⚠️ Mode test (dry-run) - Pas d\'envoi d\'emails\n');
  }
  
  // 1. Charger les données précédentes
  const previousState = loadPreviousData();
  const isFirstRun = Object.keys(previousState).length === 0;
  
  // 2. Récupérer les données actuelles
  const currentData = await fetchAllData();
  
  if (currentData.length === 0) {
    console.error('❌ Aucune donnée récupérée, arrêt');
    process.exit(1);
  }
  
  // 3. Sauvegarder l'état actuel
  const currentState = saveCurrentState(currentData);
  
  // 4. Si première exécution, pas de comparaison
  if (isFirstRun) {
    console.log('\n📌 Première exécution - État initial enregistré');
    console.log('   Les prochaines exécutions détecteront les changements.');
    process.exit(0);
  }
  
  // 5. Détecter les changements
  console.log('\n🔍 Détection des changements...');
  const changes = detectChanges(previousState, currentData);
  
  const totalChanges = changes.nouveaux.length + changes.modifies.length + changes.supprimes.length;
  
  console.log(`   - Nouveaux: ${changes.nouveaux.length}`);
  console.log(`   - Modifiés: ${changes.modifies.length}`);
  console.log(`   - Supprimés: ${changes.supprimes.length}`);
  console.log(`   - Total: ${totalChanges}`);
  
  // 6. Si pas de changements, terminer
  if (totalChanges === 0) {
    console.log('\n✅ Aucun changement détecté');
    process.exit(0);
  }
  
  // 7. Sauvegarder le rapport
  saveChangesReport(changes);
  
  // 8. Charger les abonnés et envoyer les emails
  console.log('\n📧 Envoi des alertes...');
  const { abonnes, parametres } = loadSubscribers();
  
  const activeSubscribers = abonnes.filter(a => a.actif);
  console.log(`   ${activeSubscribers.length} abonné(s) actif(s)`);
  
  if (isDryRun) {
    console.log('\n📋 Aperçu des emails qui seraient envoyés:');
    activeSubscribers.forEach(subscriber => {
      const filtered = filterChangesForSubscriber(changes, subscriber.perimetres);
      const count = filtered.nouveaux.length + filtered.modifies.length + filtered.supprimes.length;
      console.log(`   - ${subscriber.email} (${subscriber.perimetres.join(', ')}): ${count} changement(s)`);
    });
    process.exit(0);
  }
  
  let emailsSent = 0;
  
  for (const subscriber of activeSubscribers) {
    const filteredChanges = filterChangesForSubscriber(changes, subscriber.perimetres);
    const subscriberTotal = filteredChanges.nouveaux.length + filteredChanges.modifies.length + filteredChanges.supprimes.length;
    
    if (subscriberTotal === 0) {
      console.log(`   ⏭️ ${subscriber.email}: aucun changement sur son périmètre`);
      continue;
    }
    
    const subject = `${parametres.subject_prefix || '[SPE]'} ${subscriberTotal} changement(s) détecté(s)`;
    const html = generateEmailHTML(filteredChanges, subscriber.nom);
    
    const success = await sendEmailResend(
      subscriber.email,
      subscriber.nom,
      subject,
      html,
      parametres
    );
    
    if (success) emailsSent++;
    
    // Pause entre les envois
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`\n✅ Terminé: ${emailsSent}/${activeSubscribers.length} emails envoyés`);
}

// Exécution
main().catch(error => {
  console.error('❌ Erreur fatale:', error);
  process.exit(1);
});
