const SCHOOL_DOMAIN = '01.kood.tech'
const GRAPHQL_ENDPOINT = `https://${SCHOOL_DOMAIN}/graphiql`
//const GRAPHQL_ENDPOINT = `https://${SCHOOL_DOMAIN}/api/graphql-engine/v1/graphql`

const student = {
    id: 0,
    login: 'msih',
    totalXP: 0,
    level: 0,
    transactions: [],
    progresses: [],
    doneProjects: [],
}

const levelChanges = [];

const projectsBaseXP = {}

const fetchGraphQL = async (query, variables) => {
    const response = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
    })

    return await response.json()
}

const parseUserInfo = async () => {
    const obj = await fetchGraphQL(`
        query get_user($login: String) {
            user(where: {login: {_eq: $login}}) {
                id
                login
            }
        }`,
        {
            login: student.login,
        }
    )

    student.id = obj.data.user[0].id
    student.login = obj.data.user[0].login
}

const parseTransactions = async () => {
    let offset = 0

    while (true) {
        const obj = await fetchGraphQL(`
            query get_transactions($login: String, $offset: Int) {
                transaction(
                    where: {
                    user: { login: { _eq: $login } }
                    type: { _eq: "xp" }
                    object: { type: { _eq: "project" } }
                }
                offset: $offset
            ) {
                object {
                    id
                    name
                }
                amount
                createdAt
                }
            }`,
            {
                login: student.login,
                offset: offset
            }
        )

        student.transactions.push(...obj.data.transaction)

        offset += 50

        if (obj.data.transaction.length < 50) {
            offset = 0
            break
        }
    }

    student.transactions.sort((a, b) =>
        new Date(a.createdAt) > new Date(b.createdAt) ? 1 : -1
    )
}

const parseProgresses = async () => {
    let offset = 0

    while (true) {
        const obj = await fetchGraphQL(`
            query get_progresses($login: String, $offset: Int) {
                progress(
                    where: {
                        user: { login: { _eq: $login } }
                        isDone: { _eq: true }
                        object: { type: { _eq: "project" } }
                    }
                    distinct_on: objectId
                    offset: $offset
                ) {
                    object {
                        id
                        name
                    }
                }
            }`,
            {
                login: student.login,
                offset: offset,
            }
        )

        student.progresses.push(...obj.data.progress)

        offset += 50

        if (obj.data.progress.length < 50) {
            offset = 0
            break
        }
    }
}

const parseProjectsBaseXP = () => {
    student.transactions.forEach(transaction => {
        if (student.progresses.find(progress => progress.object.id == transaction.object.id)) {
            if (!projectsBaseXP[transaction.object.id]) {
                projectsBaseXP[transaction.object.id] = transaction.amount
            } else if (projectsBaseXP[transaction.object.id] < transaction.amount) {
                projectsBaseXP[transaction.object.id] = transaction.amount
            }
        }
    })
}

const parseDoneProjects = () => {
    student.transactions.forEach(transaction => {
        const projectBaseXP = projectsBaseXP[transaction.object.id]

        if (projectsBaseXP && projectBaseXP == transaction.amount) {
            student.totalXP += projectBaseXP
            const newLevel = getLevelFromXp(student.totalXP)
            
            if (newLevel > student.level) {
                student.level = newLevel
                levelChanges.push({ level: newLevel, date: new Date(transaction.createdAt) })
            }

            student.doneProjects.push({
                id: transaction.object.id,
                name: transaction.object.name,
                baseXP: projectBaseXP,
                totalXP: student.totalXP,
                date: new Date(transaction.createdAt)
            })
        }
    })

    student.doneProjects.sort((a, b) => a.date > b.date ? 1 : -1 )}

// total xp needed for this level
const totalXPForLevel = (level) => Math.round((level * 0.66 + 1) * ((level + 2) * 150 + 50))

// cumul of all the xp needed to reach this level
const cumulXpForLevel = (level) => level > 0 ? totalXPForLevel(level) + cumulXpForLevel(level - 1) : 0

// level reached for this xp
const getLevelFromXp = (xp, level = 0) => cumulXpForLevel(level) >= xp ? level : getLevelFromXp(xp, level + 1)

// get the first day of the month of a given date
const getFirstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

// get the first day of the next month of a given date
const getFirstDayOfNextMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);

// get all months between given dates in MM/YY format
const getMonths = (fromDate, toDate) => {
    const fromYear = fromDate.getFullYear();
    const fromMonth = fromDate.getMonth();
    const toYear = toDate.getFullYear();
    const toMonth = toDate.getMonth();
    const months = [];
    for (let year = fromYear; year <= toYear; year++) {
        let month = year === fromYear ? fromMonth : 0;
        const monthLimit = year === toYear ? toMonth : 11;
        for (; month <= monthLimit; month++) {
            months.push(
                (month.toString().length == 1 ? '0' + (month + 1) : (month + 1))
                + '/' +
                year.toString().substr(-2)
            )
        }
    }
    return months;
}

// prepare graphs before drawing
const fillGraphs = (xpOverTimeGraph, levelOverTimeGraph) => {
    const firstDate = getFirstDayOfMonth(student.doneProjects[0].date)
    const lastDate = getFirstDayOfNextMonth(student.doneProjects[student.doneProjects.length - 1].date)
    const firstAndLastDateDiff = lastDate.getTime() - firstDate.getTime()

    const months = getMonths(firstDate, lastDate)

    // labels for dates
    for (let i = 0; i < months.length; i++) {
        const x = (i / (months.length - 1) * xpOverTimeGraph.width) + xpOverTimeGraph.leftOffset
        const y = xpOverTimeGraph.height + 30
        const text = months[i]
        const type = 'x-label'

        xpOverTimeGraph.labels.push({ x, y, text, type })
        levelOverTimeGraph.labels.push({ x, y, text, type })
    }

    // labels for xp of "xp over date" graph
    for (let i = 0; i <= 10; i++) {
        const x = xpOverTimeGraph.leftOffset * 0.8
        const y = (i == 0 ? 0 : xpOverTimeGraph.height * (i / 10)) + 5
        const text = (i == 10 ? 0 : Math.round(student.totalXP * (1 - (i / 10)))).toLocaleString()
        const type = 'y-label'

        xpOverTimeGraph.labels.push({ x, y, text, type })
    }

    // labels for levels of "level over date" graph
    for (let i = 0; i <= student.level; i++) {
        const x = levelOverTimeGraph.leftOffset * 0.8
        const y = (i == 0 ? levelOverTimeGraph.height : (levelOverTimeGraph.height * (1 - (i / student.level)))) + 5
        const text = i
        const type = 'y-label'

        levelOverTimeGraph.labels.push({ x, y, text, type })
    }

    // data for "xp over date" graph
    for (let i = 1; i < student.doneProjects.length; i++) {
        const curr = student.doneProjects[i]
        const prev = student.doneProjects[i - 1]

        const x1 = (prev.date.getTime() - firstDate) / firstAndLastDateDiff * xpOverTimeGraph.width
        const x2 = (curr.date.getTime() - firstDate) / firstAndLastDateDiff * xpOverTimeGraph.width

        const y1 = prev.totalXP / student.totalXP * xpOverTimeGraph.height
        const y2 = curr.totalXP / student.totalXP * xpOverTimeGraph.height

        if (i == 1) {
            xpOverTimeGraph.data.push({
                type: 'circle', cx: x1, cy: y1,
                text: `0 → ${prev.totalXP.toLocaleString()} XP\n${prev.date.toLocaleDateString("en-GB")}`
            })

            xpOverTimeGraph.data.push({
                type: 'line',
                x1: 0, x2: x1,
                y1: 0, y2: y1
            })
        }

        xpOverTimeGraph.data.push({
            type: 'circle', cx: x2, cy: y2,
            text: `${prev.totalXP.toLocaleString()} → ${curr.totalXP.toLocaleString()} XP\n${curr.date.toLocaleDateString("en-GB")}`
        })

        xpOverTimeGraph.data.push({ type: 'line', x1, x2, y1, y2 })
    }

    // data for "level over date" graph
    for (let i = 0; i < levelChanges.length - 1; i++) {
        const curr = levelChanges[i]
        const next = levelChanges[i + 1]

        const x1 = (curr.date.getTime() - firstDate) / firstAndLastDateDiff * levelOverTimeGraph.width
        const x2 = (next.date.getTime() - firstDate) / firstAndLastDateDiff * levelOverTimeGraph.width

        const y1 = (curr.level) / (student.level) * levelOverTimeGraph.height
        const y2 = (next.level) / (student.level) * levelOverTimeGraph.height

        if (i == 0) {
            levelOverTimeGraph.data.push({
                type: 'circle', cx: x1, cy: y1,
                text: `0 → ${curr.level} level\n${curr.date.toLocaleDateString("en-GB")}`
            })

            levelOverTimeGraph.data.push({
                type: 'line',
                x1: 0, x2: x1,
                y1: 0, y2: y1
            })
        }

        levelOverTimeGraph.data.push({
            type: 'circle', cx: x2, cy: y2,
            text: `${curr.level} → ${next.level} level\n${next.date.toLocaleDateString("en-GB")}`
        })

        levelOverTimeGraph.data.push({ type: 'line', x1, x2, y1, y2 })
    }
}

const drawGraph = (graph) => {
    const container = document.createElement('div')
    container.classList.add('graph-container')

    const description = document.createElement('p')
    description.classList.add('graph-description')
    description.innerText = graph.description
    container.appendChild(description)

    const svg = document.createElement('svg')
    container.append(svg)
    svg.classList.add('graph')
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    svg.setAttribute('viewbox', '0 0 '+1100 +' '+ 600)

    const xGrid = document.createElement('g')
    svg.append(xGrid)
    xGrid.classList.add('grid', 'x-grid')

    const yGrid = document.createElement('g')
    svg.append(yGrid)
    yGrid.classList.add('grid', 'y-grid')

    const xLine = document.createElement('line')
    xGrid.append(xLine)
    xLine.setAttribute('x1', graph.leftOffset)
    xLine.setAttribute('x2', graph.leftOffset)
    xLine.setAttribute('y1', 0)
    xLine.setAttribute('y2', graph.topOffset)

    const yLine = document.createElement('line')
    yGrid.append(yLine)
    yLine.setAttribute('x1', graph.leftOffset)
    yLine.setAttribute('x2', graph.width + graph.leftOffset)
    yLine.setAttribute('y1', graph.topOffset)
    yLine.setAttribute('y2', graph.topOffset)

    const xLabels = document.createElement('g')
    svg.append(xLabels)
    xLabels.classList.add('labels', 'x-labels')

    const yLabels = document.createElement('g')
    svg.append(yLabels)
    yLabels.classList.add('labels', 'y-labels')

    for (let i = 0; i < graph.labels.length; i++) {
        const label = document.createElement('text')

        label.setAttribute('x', graph.labels[i].x)
        label.setAttribute('y', graph.labels[i].y)
        label.innerText = graph.labels[i].text

        if (graph.labels[i].type == 'x-label') {
            xLabels.append(label)
        }
        if (graph.labels[i].type == 'y-label') {
            yLabels.append(label)
        }
    }

    const data = document.createElement('g')
    svg.append(data)
    data.classList.add('data')

    for (let i = 0; i < graph.data.length; i++) {
        const el = document.createElement(graph.data[i].type)
        data.append(el)

        if (graph.data[i].type == 'circle') {
            el.setAttribute('cx', graph.data[i].cx + graph.leftOffset)
            el.setAttribute('cy', graph.topOffset - graph.data[i].cy)
            el.setAttribute('r', 5)
            el.innerHTML = `<title>${graph.data[i].text}</title>`
        }

        if (graph.data[i].type == 'line') {
            el.setAttribute('x1', graph.data[i].x1 + graph.leftOffset)
            el.setAttribute('x2', graph.data[i].x2 + graph.leftOffset)
            el.setAttribute('y1', graph.topOffset - graph.data[i].y1)
            el.setAttribute('y2', graph.topOffset - graph.data[i].y2)
        }
    }

    document.body.innerHTML += container.outerHTML
}

const init = async () => {
    await parseUserInfo()
    await parseTransactions()
    await parseProgresses()

    parseProjectsBaseXP()
    parseDoneProjects()

    document.getElementById('login').innerText = `${student.login}`
    document.getElementById('id').innerText = `${student.id}`
    document.getElementById('total-xp').innerText = `${student.totalXP.toLocaleString()}`
    document.getElementById('level').innerText = `${student.level}`

    const xpOverTimeGraph = {
        description: 'XP OVER TIME',
        width: 1000,
        height: 500,
        topOffset: 500,
        leftOffset: 100,
        labels: [],
        data: [],
    }

    const levelOverTimeGraph = {
        description: "LEVEL OVER TIME",
        width: 1000,
        height: 500,
        topOffset: 500,
        leftOffset: 100,
        labels: [],
        data: [],
    }

    fillGraphs(xpOverTimeGraph, levelOverTimeGraph)

    drawGraph(xpOverTimeGraph)
    drawGraph(levelOverTimeGraph)
}

init()

