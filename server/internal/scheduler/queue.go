package scheduler

import (
	"container/list"
	"sync"
)

type queueClass struct {
	browser       string
	versionPrefix string
}

type queueTicket struct {
	class   queueClass
	element *list.Element
	turn    chan struct{}
}

// Queue holds the session requests that wait for a free slot on this server
// replica. Each browser and Playwright version prefix has its own line, which
// admits requests in arrival order. Only the first request in a line receives
// turns, so a request that no worker can serve blocks only its own line.
type Queue struct {
	mu      sync.Mutex
	maxSize int
	size    int
	lines   map[queueClass]*list.List
}

func newQueue(maxSize int) *Queue {
	return &Queue{maxSize: maxSize, lines: map[queueClass]*list.List{}}
}

// Wake gives a turn to the first request in each line.
func (q *Queue) Wake() {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, line := range q.lines {
		giveTurn(line.Front())
	}
}

// Depth returns the number of waiting requests in all lines.
func (q *Queue) Depth() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.size
}

func (q *Queue) hasWaiters(class queueClass) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.lines[class] != nil
}

func (q *Queue) enter(class queueClass) (*queueTicket, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.size >= q.maxSize {
		return nil, false
	}
	line := q.lines[class]
	if line == nil {
		line = list.New()
		q.lines[class] = line
	}
	ticket := &queueTicket{class: class, turn: make(chan struct{}, 1)}
	ticket.element = line.PushBack(ticket)
	q.size++
	if line.Front() == ticket.element {
		giveTurn(ticket.element)
	}
	return ticket, true
}

func (q *Queue) leave(ticket *queueTicket) {
	q.mu.Lock()
	defer q.mu.Unlock()
	line := q.lines[ticket.class]
	wasFirst := line.Front() == ticket.element
	line.Remove(ticket.element)
	q.size--
	if line.Len() == 0 {
		delete(q.lines, ticket.class)
		return
	}
	if wasFirst {
		giveTurn(line.Front())
	}
}

func giveTurn(element *list.Element) {
	select {
	case element.Value.(*queueTicket).turn <- struct{}{}:
	default:
	}
}
