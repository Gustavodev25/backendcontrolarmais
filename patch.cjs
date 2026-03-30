const fs = require('fs');
let code = fs.readFileSync('src/pages/ConnectedBanks.ts', 'utf8');

code = code.replace(/import \{ getPluggyDocRef, loadPluggyRecords \} from '\.\.\/lib\/pluggyFirestore';/, 
`import { getPluggyDocRef, loadPluggyRecords } from '../lib/pluggyFirestore';
import { openSyncCreditsModal } from '../components/SyncCreditsModal';`);

code = code.replace(/<span class="relative z-10 sync-countdown tracking-tight" data-next-sync="\$\\{nextSyncDate\.toISOString\(\)\\}">Próxima sincronização em <span class="font-mono ml-0\.5 font-semibold text-\\[var\(--color-text\)\\]">\$\\{h\\}h \$\\{m\\}m \$\\{s\\}s<\/span><\/span>\s*<\/div>/g, 
`<span class="relative z-10 sync-countdown tracking-tight" data-next-sync="\${nextSyncDate.toISOString()}">Próxima sincronização em <span class="font-mono ml-0.5 font-semibold text-[var(--color-text)]">\${h}h \${m}m \${s}s</span></span>
                      <button id="btn-buy-sync-\${rep.id}" class="ml-auto text-[#D97757] hover:bg-[#D97757]/10 p-1.5 rounded-lg transition-colors cursor-pointer" title="Comprar atualizações extra">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                      </button>
                    </div>`);

code = code.replace(/document\.getElementById\(\`btn-rename-\$\{rep\.id\}\`\)\?\.addEventListener\('click', \(e\) => \{\s*e\.stopPropagation\(\);\s*renameInstitution\(itemId, rep\.institution\?\.name \|\| 'Banco'\);\s*\}\);/g, 
`document.getElementById(\`btn-rename-\${rep.id}\`)?.addEventListener('click', (e) => {
        e.stopPropagation();
        renameInstitution(itemId, rep.institution?.name || 'Banco');
      });
      document.getElementById(\`btn-buy-sync-\${rep.id}\`)?.addEventListener('click', (e) => {
        e.stopPropagation();
        const usr = auth.currentUser;
        if (usr) {
          openSyncCreditsModal(usr);
        }
      });`);

fs.writeFileSync('src/pages/ConnectedBanks.ts', code);
console.log('patched');
