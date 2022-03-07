import fetch, { Headers } from "node-fetch"
import onProcessExit from "when-exit"
import { readFile, writeFile } from "fs/promises"
import { writeFileSync } from "fs"
import prompts from "prompts"
import is, { assert } from "@sindresorhus/is"
import chalk from "chalk"

type HTTPMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH"

interface LocalAccount {
  name: string
  id: string
  token: string
  aliases?: string[]
}

class DiscordClient {
  baseEndpoint = "https://discord.com/api/v9/"
  token

  async apiRequest<Res extends any, Body extends any = never>(
    path: string,
    method?: HTTPMethod,
    data?: Body
  ): Promise<Res> {
    const requestOptions: RequestInit = {}
    requestOptions.headers = new Headers()

    if (data) {
      requestOptions.headers.append("Content-Type", "application/json")
      requestOptions.body = JSON.stringify(data)
    }

    const responseData = (await fetch(
      this.baseEndpoint + path.replace(/^\//, "")
    ).then((res) => res.json().catch(() => res.text()))) as Res

    return responseData
  }

  constructor(token: string) {
    this.token = token
  }
}

type PageAction =
  | string
  | (() => void)
  | null
  | [string, Record<string, unknown>?]
  | Page

interface PageActionChoice extends prompts.Choice {
  value: PageAction
}

interface Page<
  P extends Record<string, unknown> = Record<string, unknown>,
  S extends Record<string, unknown> = Record<string, unknown>
> {
  beforePrompt?: (info: { parameters: P; state: S; self: PageManager }) => void
  title?: string
  prompt?: {
    message?: string
    hint?: string
  }
  actions?: PageActionChoice[] | (() => PageActionChoice[])
}

interface PageManagerOptions {
  pages?: Record<string, Page>
  initialPage?: string
}

class HistoryItem<States = {}> {
  pageId: string
  displayName?: string
  pageParameters
  selectedPromptIndex
  state
  hidden: boolean = false

  toString() {
    return this.displayName || this.pageId
  }

  constructor(options: {
    pageId: string
    state?: States
    displayName?: string
    pageParameters?: Record<string, unknown>
    selectedPromptIndex?: number
  }) {
    this.pageId = options.pageId
    this.state = options.state
    this.displayName = options.displayName
    this.pageParameters = options.pageParameters
    this.selectedPromptIndex = options.selectedPromptIndex
  }
}

interface NavigationOptions {
  updateHistory?: boolean | number
  params?: Record<string, unknown>
  state?: Record<string, unknown>
  selectedAction?: number
  errorMessage?: string
}

class PageNotFoundError extends Error {
  pageId

  constructor(pageId: string, message?: string) {
    super(message)
    this.pageId = pageId
  }
}

class PageManager {
  history: HistoryItem[] = []
  breadcrumbs: string[] = []
  pages: Map<string, Page>
  initialPage?: string
  defaultPromptMessage
  defaultPromptHint
  shouldExit = false

  constructor(options: PageManagerOptions = {}) {
    this.pages = new Map<string, Page>(Object.entries(options.pages || {}))
    if (options.initialPage) this.setInitialPage(options.initialPage)
    this.defaultPromptMessage = "Actions"
    this.defaultPromptHint = "Choose an action, or hit Esc to go back"
  }

  private showBreadcrumbs() {
    if (this.breadcrumbs.length <= 1) return

    const arrow = chalk.cyan(" > ")
    const lastIndex = this.breadcrumbs.length - 1
    const breadcrumbText = this.breadcrumbs
      .map((item, i) => (i === lastIndex ? item : chalk.dim(item)))
      .join(arrow)

    console.log(breadcrumbText)
  }

  static resolvePageActions(actions: Record<string, PageAction>) {
    const resolvedActions: PageActionChoice[] = []
    for (const actionName in actions) {
      resolvedActions.push({
        title: actionName,
        value: actions[actionName],
      })
    }
    return resolvedActions
  }

  appendHistoryItem(pageId: string, pageParameters?: Record<string, unknown>) {
    const historyItem = new HistoryItem({
      pageId,
      pageParameters,

      displayName: this.pages.get(pageId)?.title,
    })

    this.history.push(historyItem)
  }

  getLastHistoryItem() {
    return this.history.slice(-1)[0]
  }

  setInitialPage(pageId: string) {
    if (!this.pages.has(pageId))
      throw new Error(
        `Cannot have an initial page that doesn't exist: ${pageId} (available pages: ${this.pages.size})`
      )
    this.initialPage = pageId
  }

  navigateTo(pageId: string, options: NavigationOptions = {}) {
    const refresh = (selectedAction: number, errorMessage?: string) => {
      const newOptions = options
      newOptions.errorMessage = errorMessage
      newOptions.updateHistory = false
      newOptions.selectedAction = selectedAction
      this.navigateTo(pageId, options)
    }

    const navigateOrCatch = (
      page: string,
      options: NavigationOptions = {},
      selectedAction?: number
    ) => {
      try {
        this.navigateTo(page, options)
      } catch (error) {
        const message =
          error instanceof PageNotFoundError
            ? "Page not found: " + page
            : `Failed to navigate to page "${page}": ${error}`

        refresh(
          is.number(options.updateHistory)
            ? options.updateHistory
            : selectedAction || 0,
          message
        )
      }
    }

    options.params ??= {}
    options.state ??= {}
    // Required for TypeScript to admit that this could still be `false`
    options.updateHistory ?? (options.updateHistory = true)

    const page = this.pages.get(pageId)
    if (!page)
      throw new PageNotFoundError(
        pageId,
        `Could not find page: ${pageId} (available pages: ${this.pages.size})`
      )

    const pageActions = is.function_(page.actions)
      ? page.actions()
      : page.actions

    console.clear()

    if (options.updateHistory !== false)
      this.breadcrumbs.push(page.title || pageId)
    this.showBreadcrumbs()

    if (options.errorMessage) console.log(chalk.red(options.errorMessage))

    try {
      page.beforePrompt?.({
        parameters: options.params,
        state: options.state,
        self: this,
      })
    } catch (error) {
      console.log(chalk.red(`Failed to run beforePrompt(): ${error}`))
    }

    if (is.number(options.updateHistory))
      this.getLastHistoryItem().selectedPromptIndex = options.updateHistory
    if (options.updateHistory !== false)
      this.appendHistoryItem(pageId, options.params)
    if (!pageActions) return

    prompts({
      name: "action",
      type: "select",
      message: page.prompt?.message || page.title || this.defaultPromptMessage,
      hint: page.prompt?.hint || this.defaultPromptHint,
      choices: pageActions,
      initial: options.selectedAction,
      onState: ({ aborted }: { value: string; aborted: boolean }) => {
        // We can't do this because there is no way to differentiate between Ctrl+C and Esc.
        // https://github.com/terkelg/prompts/issues/252
        // if (aborted) this.exit()
      },
    }).then(({ action }: { action: PageAction }) => {
      const selectedAction = pageActions?.findIndex((a) => a.value === action)

      // Go back to the previous page if the user pressed esc
      if (is.undefined(action)) return this.navigateBack()
      // If the action is `null`, do nothing
      if (is.null_(action)) return refresh(selectedAction)
      // If a page ID is provided, navigate to it
      if (is.string(action))
        return navigateOrCatch(action, { updateHistory: selectedAction })
      // Use a custom function (if present)
      if (is.function_(action)) {
        let errorMessage
        try {
          action()
        } catch (error) {
          errorMessage = `Failed to execute menu item "${pageActions[selectedAction].title}": ${error}`
        }
        return refresh(selectedAction, errorMessage)
      }
      // If a page ID with parameters is provided, navigate to it
      if (is.array(action)) {
        const [pageId, params] = action
        return navigateOrCatch(pageId, {
          updateHistory: selectedAction,
          params,
        })
      }
      if (is.object(action)) {
        const inlinePageId = `${pageId}/${selectedAction}`
        action.title ??= pageActions[selectedAction].title
        this.pages.set(inlinePageId, action)
        return navigateOrCatch(inlinePageId, { updateHistory: selectedAction })
      }
    })
  }

  navigateBack(errorMessage?: string) {
    if (this.shouldExit) return

    // Remove the last history item
    this.history.pop()
    this.breadcrumbs.pop()

    // Navigate to the (new) last history item,
    // or exit if there are no items left
    const prevHistoryItem = this.getLastHistoryItem()
    if (!prevHistoryItem) return this.exit()
    this.navigateTo(prevHistoryItem.pageId, {
      updateHistory: false,
      errorMessage,
      params: prevHistoryItem.pageParameters,
      selectedAction: prevHistoryItem.selectedPromptIndex,
      state: prevHistoryItem.state,
    })
  }

  init() {
    if (!this.initialPage)
      throw new Error("Set an initialPage before calling init()!")
    this.navigateTo(this.initialPage)
  }

  exit() {
    // Show the terminal cursor
    process.stdout.write("\x1B[?25h")
    this.shouldExit = true
  }

  async promptOrBack(options: prompts.PromptObject) {
    const res = await prompts(options)
    if (!is.emptyObject(res)) return res
    this.navigateBack()
  }
}

function emptyCallback(...args: unknown[]) {
  return
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
  writeFileSync(accountsFilePath, JSON.stringify(accountsDatabase, null, "  "))
  console.log("Exiting!")
}

function generateAccountsList() {
  const actions: PageActionChoice[] = []

  accountsDatabase.forEach((account) => {
    actions.push({
      title: account.name,
      value: [
        "accountInfo",
        {
          account,
        },
      ],
      description: account.aliases
        ? `AKA: ` + account.aliases.join(", ")
        : undefined,
    })
  })

  return actions
}

function accountOrThrow(o: unknown): asserts o is LocalAccount {
  assert.object(o)
  assert.string(o.name)
  assert.string(o.id)
  assert.string(o.token)
  if (o.aliases) {
    assert.array(o.aliases)
    o.aliases.forEach(assert.string)
  }
}

const showAccountInfo: Page["beforePrompt"] = ({ parameters: { account } }) => {
  accountOrThrow(account)

  console.clear()
  console.log(chalk.bold(account.name))
  account.aliases?.forEach((alias) => {
    console.log(chalk.dim(`AKA ${alias}`))
  })
  console.log()
  console.log(chalk.cyan("User ID: ") + account.id)
  console.log(chalk.cyan("Token:   ") + sanitizeToken(account.token))
  console.log()
}

console.log("Loading account database file...")

const accountsFilePath = "accounts.json"
const accountsDatabase = await loadAccountsFile()
onProcessExit(flushAccountsFile)

new PageManager({
  pages: {
    main: {
      title: "Blurple Control Panel",
      actions: PageManager.resolvePageActions({
        "View accounts": "accountsList",
        Tests: "tests",
      }),
    },
    accountsList: {
      actions: generateAccountsList,
      prompt: {
        message: "Accounts",
        hint: "Select an account to view info, or hit Esc to go back",
      },
    },
    accountInfo: {
      actions: PageManager.resolvePageActions({ Nope: null }),
      beforePrompt: showAccountInfo,
    },
    tests: {
      actions: PageManager.resolvePageActions({
        "Page with no parameters": ["testPage"],
        "Page with some params": [
          "testPage",
          {
            count: 1,
          },
        ],
        'Inline ("anonymous") page': {
          actions: PageManager.resolvePageActions({
            Nothing: null,
          }),
        },
      }),
    },
    testPage: {
      beforePrompt: ({ parameters }) => console.log(parameters),
      actions: PageManager.resolvePageActions({
        Nothing: null,
      }),
    },
  },
  initialPage: "main",
}).init()
