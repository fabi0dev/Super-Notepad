/**
 * Rótulos curtos em PT-BR para o painel de atividade do chat web.
 * Alinhado com `frontend/tui/src/lib/text.ts` (`toolKindLabel`).
 */

const TOOL_LABELS_PT: Readonly<Record<string, string>> = {
  web_search: "Pesquisando na web",
  web_extract: "Extraindo conteúdo",
  web_crawl: "Rastreando site",
  shell: "Comando no terminal",
  terminal: "Comando no terminal",
  process: "Gerenciando processo",
  read_file: "Lendo arquivo",
  write_file: "Escrevendo arquivo",
  edit_file: "Editando arquivo",
  patch: "Aplicando patch",
  search_files: "Buscando arquivos",
  list_files: "Listando arquivos",
  search: "Buscando no projeto",
  execute_code: "Executando código",
  delegate_task: "Delegando tarefa",
  mixture_of_agents: "Raciocinando em conjunto",
  session_search: "Buscando na sessão",
  memory: "Consultando memória",
  set_user_profile: "Atualizando perfil",
  todo: "Atualizando tarefas",
  wiser: "Perguntando ao usuário",
  ask_user: "Perguntando ao usuário",
  clarify: "Perguntando ao usuário",
  skills_list: "Listando skills",
  skill_view: "Abrindo skill",
  skill_manage: "Gerenciando skill",
  vision_analyze: "Analisando imagem",
  image_generate: "Gerando imagem",
  text_to_speech: "Gerando áudio",
  browser_navigate: "Abrindo página",
  browser_snapshot: "Capturando snapshot",
  browser_scroll: "Rolando a página",
  browser_click: "Clicando",
  browser_type: "Digitando",
  browser_back: "Voltando",
  browser_forward: "Avançando",
  browser_reload: "Recarregando",
  browser_wait: "Aguardando página",
  browser_press: "Pressionando tecla",
  browser_get_images: "Listando imagens",
  browser_vision: "Analisando a página",
  browser_console: "Lendo console",
  browser_cdp: "Usando CDP",
  browser_dialog: "Tratando diálogo",
  cronjob: "Gerenciando agendamento",
  send_message: "Enviando mensagem",
  gateway_inspect: "Verificando canais de mensagem",
  rl_list_environments: "Listando ambientes RL",
  rl_select_environment: "Selecionando ambiente RL",
  rl_get_current_config: "Lendo configuração RL",
  rl_edit_config: "Editando configuração RL",
  rl_start_training: "Iniciando treino RL",
  rl_check_status: "Verificando treino RL",
  rl_stop_training: "Parando treino RL",
  rl_get_results: "Obtendo resultados RL",
  rl_list_runs: "Listando execuções RL",
  rl_test_inference: "Testando inferência RL",
  // Agenda / calendário
  calendar_agenda: "Consultando agenda",
  calendar_add_event: "Criando evento",
  calendar_update_event: "Atualizando evento",
  calendar_delete_event: "Excluindo evento",
  // Contatos
  contacts_list: "Listando contatos",
  contacts_search: "Buscando contatos",
  contacts_get: "Abrindo contato",
  contact_add: "Adicionando contato",
  contact_update: "Atualizando contato",
  contact_delete: "Excluindo contato",
  // E-mail
  email_check: "Verificando e-mails",
  email_search: "Buscando e-mails",
  email_read: "Lendo e-mail",
  email_send: "Enviando e-mail",
  email_mark_read: "Marcando e-mail como lido",
  email_set_importance: "Marcando importância",
  // Notas
  notes_list: "Listando notas",
  notes_search: "Buscando notas",
  notes_read: "Lendo nota",
  notes_create: "Criando nota",
  notes_update: "Atualizando nota",
  notes_append: "Anexando à nota",
  notes_linked: "Vendo notas vinculadas",
  // Lembretes
  reminders_list: "Listando lembretes",
  reminder_add: "Criando lembrete",
  reminder_complete: "Concluindo lembrete",
  reminder_delete: "Excluindo lembrete",
  // Tarefas
  tasks_list: "Listando tarefas",
  task_add: "Criando tarefa",
  task_update: "Atualizando tarefa",
  task_subtask: "Atualizando subtarefa",
  task_delete: "Excluindo tarefa",
  // Drive
  drive_list: "Listando arquivos do Drive",
  drive_search: "Buscando no Drive",
  // Eco (gravações)
  eco_list_recordings: "Listando gravações",
  eco_search_recordings: "Buscando gravações",
  eco_get_recording: "Abrindo gravação",
  // Coworking (integrações)
  coworking_list_integrations: "Listando integrações",
  coworking_add_integration: "Adicionando integração",
  coworking_set_guide: "Configurando integração",
  coworking_call: "Chamando integração",
  // Finanças
  finance_add_transaction: "Registrando lançamento",
  finance_update_transaction: "Atualizando lançamento",
  finance_delete_transaction: "Removendo lançamento",
  finance_delete_transactions: "Removendo lançamentos",
  finance_transactions: "Consultando lançamentos",
  finance_summary: "Resumindo finanças",
  finance_accounts: "Consultando contas",
  finance_add_account: "Criando conta",
  finance_categories: "Listando categorias",
  finance_add_recurring: "Criando recorrência",
  finance_add_installment: "Criando parcelamento",
  finance_transfer: "Transferindo entre contas",
  finance_set_budget: "Definindo orçamento",
  finance_budgets: "Consultando orçamentos",
  finance_import: "Importando extrato",
  // Diversos
  document_extract: "Extraindo documento",
  conversation: "Gerenciando a conversa",
  mark_chapter: "Marcando capítulo",
};

const TOOL_FALLBACK_VERB_PT: Readonly<Record<string, string>> = {
  list: "Listando",
  get: "Obtendo",
  read: "Lendo",
  write: "Escrevendo",
  search: "Buscando",
  execute: "Executando",
  call: "Chamando",
  send: "Enviando",
  edit: "Editando",
  patch: "Aplicando patch",
  create: "Criando",
  delete: "Removendo",
  add: "Adicionando",
  select: "Selecionando",
  start: "Iniciando",
  stop: "Parando",
  check: "Verificando",
  test: "Testando",
  query: "Consultando",
  reply: "Respondendo",
  analyze: "Analisando",
  generate: "Gerando",
  navigate: "Navegando",
  snapshot: "Capturando snapshot",
  click: "Clicando",
  type: "Digitando",
  scroll: "Rolando",
  press: "Pressionando tecla",
  vision: "Analisando com visão",
  console: "Lendo console",
  dialog: "Tratando diálogo",
  cdp: "Usando CDP",
  extract: "Extraindo",
  crawl: "Rastreando",
  delegate: "Delegando",
  manage: "Gerenciando",
  view: "Abrindo",
  run: "Executando",
  train: "Treinando",
};

const TOOL_FALLBACK_NOUN_PT: Readonly<Record<string, string>> = {
  code: "código",
  task: "tarefa",
  file: "arquivo",
  files: "arquivos",
  session: "sessão",
  memory: "memória",
  message: "mensagem",
  entities: "entidades",
  services: "serviços",
  state: "estado",
  service: "serviço",
  config: "configuração",
  results: "resultados",
  runs: "execuções",
  environments: "ambientes",
  environment: "ambiente",
  inference: "inferência",
  training: "treino",
  status: "status",
};

function fallbackToolDisplayLabel(name: string): string {
  if (name.startsWith("mcp_")) {
    return "Ferramenta MCP";
  }
  if (name.startsWith("rl_")) {
    const tail = name
      .slice(3)
      .split("_")
      .filter(Boolean)
      .map((p) => TOOL_FALLBACK_NOUN_PT[p] ?? p)
      .join(" ");
    return tail ? `Treinamento RL · ${tail}` : "Treinamento RL";
  }
  if (name.startsWith("browser_")) {
    const mapped = TOOL_LABELS_PT[`browser_${name.slice("browser_".length)}`];
    if (mapped) {
      return mapped;
    }
  }

  const parts = name.split("_").filter(Boolean);
  const verb = parts[0] ?? "";
  const prefix = TOOL_FALLBACK_VERB_PT[verb];
  if (prefix) {
    const tail = parts
      .slice(1)
      .map((p) => TOOL_FALLBACK_NOUN_PT[p] ?? p)
      .join(" ");
    return tail ? `${prefix} ${tail}` : prefix;
  }

  return parts.map((p) => TOOL_FALLBACK_NOUN_PT[p] ?? p).join(" ") || "Ferramenta";
}

export function getToolDisplayLabel(toolName: string): string {
  const key = toolName.trim().toLowerCase();
  if (!key) {
    return "Ferramenta";
  }
  return TOOL_LABELS_PT[key] ?? fallbackToolDisplayLabel(key);
}
