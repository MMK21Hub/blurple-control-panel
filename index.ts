import fetch from "node-fetch"
import onProcessExit from "when-exit"
import { readFile, writeFile } from "fs/promises"
import { writeFileSync } from "fs"
import prompts from "prompts"
import { assert } from "@sindresorhus/is"
import chalk from "chalk"
import promptsHelpers from "prompts-helpers"

type HTTPMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH"

interface LocalAccount {
  name: string
  id: string
  token: string
  aliases?: string[]
}

interface ActionChoice extends prompts.Choice {
  value: () => void
}

class DiscordClient {
  baseEndpoint = "https://discord.com/api/v9/"
  token: string

  async apiRequest<Res extends any, Body extends any = never>(
    path: string,
    method?: HTTPMethod,
    data?: Body
  ): Promise<Res> {
    const requestOptions: RequestInit = {}

    if (data) {
      requestOptions.headers["Content-Type"] = "application/json"
      requestOptions.body = JSON.stringify(data)
    }

    const responseData = (await fetch(
      this.baseEndpoint + path.replace(/^\//, "")
    ).then((res) => res.json().catch(() => res.text()))) as Res

    return responseData
  }

  constructor(token) {
    this.token = token
  }
}

function sanitizeToken(token: string) {
  return token
    .split(".")
    .map((value, i) => (i > 1 ? value.replace(/./g, "*") : value))
    .join(".")
}

async function loadAccountsFile() {
  const fileContents = await readFile(accountsFilePath, "utf-8").catch(
    async (err) => {
      if (err.code != "ENOENT") throw err

      console.log(
        `Could not find accounts file at ${accountsFilePath}. Creating a new file.`
      )
      await writeFile(accountsFilePath, JSON.stringify([]), "utf-8")
      return readFile(accountsFilePath, "utf-8")
    }
  )

  try {
    return JSON.parse(fileContents) as LocalAccount[]
  } catch {
    console.warn(`Contents of file ${accountsFilePath} is not valid JSON`)
    return []
  }
}

function flushAccountsFile() {
  console.clear()
  console.log(`Saving ${accountsFilePath}...`)
  writeFileSync(accountsFilePath, JSON.stringify(accountsDatabase))
  console.log("Exiting!")
}

function getAccountFromDatabase(id: string) {
  const matchingAccounts = accountsDatabase.filter(
    (account) => account.id === id
  )
  if (matchingAccounts.length > 1)
    throw new Error(
      "Found multiple accounts with the same ID in the database: " + id
    )
  return matchingAccounts ? matchingAccounts[0] : null
}

async function initialActionPrompt() {
  const actions: prompts.Choice[] = [
    { title: "View accounts", value: showAccountsList },
  ]

  await prompts({
    name: "action",
    message: "Blurple Control Panel",
    type: "select",
    instructions: false,
    choices: actions,
  }).then(async ({ action }) => await action())
}

async function showAccountsList() {
  const promptOptions: prompts.PromptObject<string> = {
    name: "account",
    message: "Accounts",
    type: "select",
    hint: "Select an account to view info, or hit esc to go back",
    limit: 20,
    choices: [],
  }
  accountsDatabase.forEach((account) => {
    assert.array(promptOptions.choices)
    let accountListItem =
      `${account.name}` +
      (account.aliases ? ` (${account.aliases.join(", ")})` : "")
    promptOptions.choices.push({ title: accountListItem, value: account.id })
  })

  console.clear()
  await prompts(promptOptions).then(async ({ account: id }) => {
    await showAccountInfo(id)
  })
}

async function showAccountInfo(id: string) {
  const account = getAccountFromDatabase(id)
  console.clear()
  console.log(chalk.cyan("Username: ") + account.name)
  console.log(chalk.cyan("User ID:  ") + account.id)
  console.log(chalk.cyan("Token:    ") + sanitizeToken(account.token))
  if (account.aliases)
    console.log("\nAKA " + chalk.dim(account.aliases.join(", ")))
  console.log()

  actionPrompt({ Nope: () => {} })
}

async function actionPrompt(
  actions: Record<string, () => void>,
  title: string = "Actions",
  hint?: string
) {
  const choices: prompts.Choice[] = []

  for (const actionName in actions) {
    choices.push({
      title: actionName,
      value: actions[actionName],
    })
  }

  await prompts({
    name: "action",
    message: title,
    type: "select",
    instructions: false,
    hint,
    choices,
  })
}

console.log("Loading account database file...")

const accountsFilePath = "accounts.json"
const accountsDatabase = await loadAccountsFile()
onProcessExit(flushAccountsFile)

await initialActionPrompt()
