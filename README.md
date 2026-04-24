# StockFlow — Gestão de Estoque & Vendas

Sistema completo para gerenciar estoque, cadastrar vendas, controlar produção e manter histórico. Funciona em qualquer dispositivo via GitHub Pages + Firebase.

---

## 📦 Funcionalidades

- **Estoque**: Cadastre produtos com nome, categoria, quantidade, preço de custo/venda, estoque mínimo (alerta)
- **Vendas**: Cadastre pedidos com cliente, itens, total, data de entrega, pagamento
- **Produção**: Lista todas as vendas pendentes de produção — marque como produzido com um clique
- **Histórico**: Registro permanente de tudo que foi produzido, com filtro por data
- **Dashboard**: Visão geral de estoque, pendências e produção do dia
- **Multi-dispositivo**: Dados sincronizados em tempo real via Firebase Firestore
- **Autenticação**: Login por e-mail/senha, dados isolados por usuário

---

## 🚀 Configuração passo a passo

### 1. Criar projeto Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Clique em **Criar projeto** → dê um nome (ex: `meu-estoque`)
3. Pode desativar o Google Analytics se quiser

### 2. Ativar Autenticação

1. No menu lateral: **Authentication** → **Sign-in method**
2. Ative **E-mail/senha**
3. Salve

### 3. Criar banco Firestore

1. No menu lateral: **Firestore Database** → **Criar banco de dados**
2. Escolha **Modo de produção**
3. Selecione uma região (ex: `southamerica-east1` para Brasil)
4. Após criado, clique em **Regras** e cole o conteúdo do arquivo `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usuarios/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

5. Clique em **Publicar**

### 4. Registrar app Web

1. Na página inicial do projeto, clique no ícone **`</>`** (Web)
2. Dê um apelido (ex: `stockflow-web`)
3. **Não** marque "Firebase Hosting" (usaremos GitHub Pages)
4. Copie o objeto `firebaseConfig` que aparece

### 5. Configurar o arquivo firebase-config.js

Abra o arquivo `firebase-config.js` e substitua os valores:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",           // ← cole aqui
  authDomain: "meu-projeto.firebaseapp.com",
  projectId: "meu-projeto",
  storageBucket: "meu-projeto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 6. Publicar no GitHub Pages

1. Crie um repositório no GitHub (pode ser público ou privado)
2. Faça upload de todos os arquivos para a branch `main`:
   - `index.html`
   - `style.css`
   - `app.js`
   - `firebase-config.js`
3. No repositório → **Settings** → **Pages**
4. Em **Source**, selecione `Deploy from a branch` → branch `main` → pasta `/ (root)`
5. Clique em **Save**
6. Em alguns minutos, o site estará em `https://seu-usuario.github.io/nome-do-repo`

---

## 🛡️ Domínio autorizado no Firebase

Para o login funcionar no GitHub Pages:

1. No Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Clique em **Add domain**
3. Adicione: `seu-usuario.github.io`
4. Salve

---

## 📱 Usando em vários dispositivos

O app funciona nativamente no navegador de qualquer dispositivo (celular, tablet, computador). Para instalar como app no celular:

- **Android (Chrome)**: Abra o site → menu do Chrome → "Adicionar à tela inicial"
- **iOS (Safari)**: Abra o site → botão de compartilhar → "Adicionar à Tela de Início"

---

## 🗂️ Estrutura dos dados no Firestore

```
usuarios/
  {userId}/
    produtos/
      {produtoId}: { nome, categoria, quantidade, unidade, custo, preco, minimo, obs }
    vendas/
      {vendaId}: { cliente, contato, itens[], total, pagamento, pagStatus, status, obs, criadoEm, produzidoEm }
```

---

## ❓ Dúvidas comuns

**O login não funciona no GitHub Pages**
→ Verifique se adicionou `seu-usuario.github.io` nos domínios autorizados do Firebase Authentication.

**Os dados não sincronizam**
→ Verifique se as regras do Firestore foram aplicadas corretamente.

**Quero usar com múltiplos usuários / equipe**
→ Cada e-mail cadastrado tem seus próprios dados isolados. Basta criar uma conta com e-mail diferente.
