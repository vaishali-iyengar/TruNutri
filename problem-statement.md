# Brief

Build the prototype of a chatbot that answers questions about food, nutrition, and food safety.

Nothing sits under it yet, so it answers from the model's own memory. It'll make things up, and you'll be writing down what it makes up.

## What You Build

### 1. Chat Frontend

A message list, an input box, and a sources panel next to the conversation.

The sources panel stays empty this week. Build it now, since Milestone 2 fills it.

### 2. Backend

A chat endpoint, somewhere to store the conversation, and the model call.

Keep the model call on your server, not in the browser.

### 3. Response Schema

The model returns structured output, not prose.

The response should contain:

- Answer text
- A list of claims
  - Each claim should contain:
    - Claim text
    - Source field

Parse against the schema and fail when it doesn't parse.

### 4. System Prompt

The assistant should be able to answer queries based on general facts and information available regarding food, nutrition, and food safety.

It should answer in a structured format where the answer or claim comes first, then the source is cited in short within the answer. Detailed source is shown in the source section.

The answer length should depend on the query asked, but should be kept under 1000 characters. Bullets can be used if needed.

The assistant should not provide: calorie or weight targets, recommendations about what anyone should weigh, medical advice. It should decline these questions and point the person to a qualified professional. A line in the prompt won't hold on its own, so put the check in code as well.

Keep a fixed set of questions and re-run all of them after every prompt change.

Fixing one case while quietly breaking three others is the usual way this goes wrong.

### 5. Scope Limits, Enforced in Code

The assistant should not provide:

- Calorie or weight targets
- Recommendations about what anyone should weigh
- Medical advice

It should decline these questions and point the person to a qualified professional.

A line in the prompt won't hold on its own, so put the check in code as well.

### 6. Deploy

Push the project to GitHub and deploy it using:

- Vercel for frontend
- Railway for backend

## Model Requirements

Both Anthropic and OpenAI have structured output modes. Use structured outputs rather than parsing prose yourself.

## Rules

- Every response must parse against your schema.
- The schema must include a claims list and a source field for each claim.
- Source fields must stay `null`.
- Scope limits must live in code, not just in the prompt.
- The app must be live at a public URL.
- Failures must be recorded, not patched around.
- Model calls must run behind your backend.
